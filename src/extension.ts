import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getExecutableAgent, loadBundledAgents, resolveAgents } from "./agents.ts";
import { assertModelAllowed, loadSettings } from "./config.ts";
import { isRetryableProviderFailure, runChild } from "./process.ts";
import { renderCall, renderResult } from "./render.ts";
import { Semaphore } from "./semaphore.ts";
import { assertToolLaunchPlan, resolveToolLaunchPlan } from "./tool-resolution.ts";
import {
	AGENT_NAMES,
	type AgentRunResult,
	type ModelAttempt,
	type RegisteredToolInfo,
	type ResolvedSettings,
	type SubagentToolDetails,
	type UsageStats,
} from "./types.ts";

const parameters = Type.Object({
	agent: StringEnum(AGENT_NAMES, { description: "Agent role to invoke" }),
	task: Type.String({ minLength: 1, description: "Complete standalone task with all required context" }),
	cwd: Type.Optional(
		Type.String({ minLength: 1, description: "Child working directory; defaults to parent cwd" }),
	),
	timeoutMs: Type.Optional(
		Type.Integer({ minimum: 1_000, maximum: 3_600_000, description: "Hard child timeout in milliseconds" }),
	),
});

interface ConcurrencyPool {
	global: Semaphore;
	writer: Semaphore;
}

function emptyUsage(): UsageStats {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

function addUsage(target: UsageStats, source: UsageStats): void {
	target.input += source.input;
	target.output += source.output;
	target.cacheRead += source.cacheRead;
	target.cacheWrite += source.cacheWrite;
	target.cost += source.cost;
	target.contextTokens = source.contextTokens;
	target.turns += source.turns;
}

function configuredModel(model: string | undefined, parentModel: string | undefined): string | undefined {
	if (!model || model === "inherit") return parentModel;
	return model;
}

function modelCandidates(
	settings: ResolvedSettings,
	agentModel: string | undefined,
	agentFallbacks: string[],
	parentModel: string | undefined,
): string[] {
	const primary = configuredModel(agentModel, parentModel);
	const values = [primary, ...agentFallbacks.map((model) => configuredModel(model, parentModel))];
	const candidates = [...new Set(values.filter((value): value is string => Boolean(value)))];
	if (candidates.length === 0)
		throw new Error("No subagent model is configured and the parent has no active model");
	for (const candidate of candidates) assertModelAllowed(candidate, settings.allowedModels);
	return candidates;
}

function attemptFromResult(result: AgentRunResult): ModelAttempt {
	return {
		model: result.model,
		exitCode: result.exitCode,
		stopReason: result.stopReason,
		error: result.error,
		usage: { ...result.usage },
	};
}

function formatFailure(result: AgentRunResult): string {
	const attempts = result.attempts
		.map(
			(attempt) => `${attempt.model}: ${attempt.error ?? attempt.stopReason ?? `exit ${attempt.exitCode}`}`,
		)
		.join("; ");
	return `Subagent '${result.agent}' failed. ${attempts || result.error || result.output}`;
}

export default function registerMinimalSubagents(pi: ExtensionAPI): void {
	const definitions = loadBundledAgents();
	const pools = new Map<string, ConcurrencyPool>();
	const getPool = (settings: ResolvedSettings): ConcurrencyPool => {
		const key = `${settings.maxConcurrency}:${settings.maxWriterConcurrency}`;
		let pool = pools.get(key);
		if (!pool) {
			pool = {
				global: new Semaphore(settings.maxConcurrency),
				writer: new Semaphore(settings.maxWriterConcurrency),
			};
			pools.set(key, pool);
		}
		return pool;
	};

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description:
			"Run one fresh, isolated scout, reviewer, or worker. The child has no conversation history, so the task must include all necessary context. Emit multiple independent subagent calls in one assistant turn for parallel read-only work; worker calls are serialized by default.",
		promptSnippet: "Delegate one focused task to scout, reviewer, or worker",
		promptGuidelines: [
			"Use subagent for delegated reasoning, review, research, or implementation, not to parallelize trivial file reads.",
			"Every subagent task must be standalone because children do not inherit parent conversation history.",
			"Use scout for local codebase reconnaissance, reviewer for independent plan/code review or web research, and worker for implementation.",
			"Multiple worker subagent calls targeting the same checkout are serialized; do not expect parallel writes.",
		],
		parameters,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const settings = loadSettings(ctx.cwd, ctx.isProjectTrusted());
			const agents = resolveAgents(settings, definitions);
			const agent = getExecutableAgent(agents, params.agent);
			const cwd = params.cwd ?? ctx.cwd;
			const timeoutMs = params.timeoutMs ?? agent.timeoutMs;
			const parentModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
			const candidates = modelCandidates(settings, agent.model, agent.fallbackModels, parentModel);
			const registeredTools = pi.getAllTools() as RegisteredToolInfo[];
			const toolPlan = resolveToolLaunchPlan(agent.tools, registeredTools, settings.toolExtensions, cwd);
			assertToolLaunchPlan(toolPlan);
			const pool = getPool(settings);
			const queued: AgentRunResult = {
				agent: agent.name,
				task: params.task,
				model: candidates[0],
				output: "",
				exitCode: -1,
				usage: emptyUsage(),
				attempts: [],
				progress: { status: "queued", toolCount: 0, tools: [], lastMessage: "", durationMs: 0 },
				truncated: false,
			};
			const update = (result: AgentRunResult) => {
				onUpdate?.({
					content: [{ type: "text", text: result.progress.lastMessage || `(${result.progress.status}...)` }],
					details: { result },
				});
			};
			update(queued);

			const executeModels = async (): Promise<AgentRunResult> => {
				const attempts: ModelAttempt[] = [];
				const aggregateUsage = emptyUsage();
				let finalResult: AgentRunResult | undefined;
				for (let index = 0; index < candidates.length; index++) {
					const model = candidates[index];
					const result = await runChild({
						agent,
						model,
						task: params.task,
						cwd,
						timeoutMs,
						toolPlan,
						signal,
						onProgress: (progress) => {
							progress.attempts = [...attempts];
							update(progress);
						},
					});
					attempts.push(attemptFromResult(result));
					addUsage(aggregateUsage, result.usage);
					result.attempts = [...attempts];
					result.usage = { ...aggregateUsage };
					finalResult = result;
					if (result.progress.status === "completed") return result;
					if (!isRetryableProviderFailure(result) || index === candidates.length - 1) break;
					result.progress.lastMessage = `Model ${model} failed; retrying with ${candidates[index + 1]}`;
					update(result);
				}
				if (!finalResult) throw new Error("Subagent did not produce a result");
				throw new Error(formatFailure(finalResult));
			};

			const runWithGlobalSlot = () => pool.global.run(executeModels, signal);
			const result = agent.writer
				? await pool.writer.run(runWithGlobalSlot, signal)
				: await runWithGlobalSlot();
			return {
				content: [{ type: "text", text: result.output || "(no output)" }],
				details: { result },
			};
		},
		renderCall,
		renderResult(result, options, theme) {
			return renderResult(result as AgentToolResult<SubagentToolDetails>, options, theme);
		},
	});

	pi.registerCommand("minimal-subagents", {
		description: "Show resolved minimal subagent roles, models, and tool availability",
		handler: async (_args, ctx) => {
			const settings = loadSettings(ctx.cwd, ctx.isProjectTrusted());
			const agents = resolveAgents(settings, definitions);
			const registeredTools = pi.getAllTools() as RegisteredToolInfo[];
			const lines = ["Minimal subagents:"];
			for (const agent of agents) {
				const plan = resolveToolLaunchPlan(agent.tools, registeredTools, settings.toolExtensions, ctx.cwd);
				const state = agent.disabled ? "disabled" : "enabled";
				const model = agent.model ?? "inherit parent";
				const toolIssue = [...plan.missingTools, ...plan.unloadableTools];
				lines.push(
					`- ${agent.name}: ${state}; model ${model}; tools ${agent.tools.join(", ")}` +
						(toolIssue.length > 0 ? `; unavailable ${toolIssue.join(", ")}` : ""),
				);
			}
			pi.sendMessage({
				customType: "minimal-subagents-diagnostics",
				content: lines.join("\n"),
				display: true,
			});
		},
	});
}
