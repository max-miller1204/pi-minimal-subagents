import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	truncateHead,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import type { AgentRunResult, ChildRunOptions, ToolEvent, UsageStats } from "./types.ts";

const TASK_ARGUMENT_LIMIT = 8_000;
const STDERR_LIMIT = 50 * 1024;
const MAX_TOOL_EVENTS = 30;
const KILL_GRACE_MS = 3_000;

function emptyUsage(): UsageStats {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return Boolean(
				part && typeof part === "object" && part.type === "text" && typeof part.text === "string",
			);
		})
		.map((part) => part.text)
		.join("\n");
}

function previewTool(args: Record<string, unknown>): string {
	const value = args.command ?? args.path ?? args.query ?? args.url ?? args.pattern;
	if (value !== undefined) return String(value).replace(/\s+/g, " ").slice(0, 160);
	return JSON.stringify(args).replace(/\s+/g, " ").slice(0, 160);
}

function cloneResult(result: AgentRunResult): AgentRunResult {
	return {
		...result,
		usage: { ...result.usage },
		attempts: result.attempts.map((attempt) => ({ ...attempt, usage: { ...attempt.usage } })),
		progress: {
			...result.progress,
			tools: result.progress.tools.map((tool) => ({ ...tool })),
		},
	};
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const testEntry = process.env.PI_MINIMAL_SUBAGENTS_PI_ENTRY;
	if (testEntry) return { command: process.execPath, args: [testEntry, ...args] };
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(execName)) return { command: process.execPath, args };
	return { command: "pi", args };
}

async function buildArguments(options: ChildRunOptions): Promise<{ args: string[]; tempDir: string }> {
	const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-minimal-subagent-"));
	const promptPath = path.join(tempDir, `${options.agent.name}-prompt.md`);
	await withFileMutationQueue(promptPath, () =>
		fs.promises.writeFile(promptPath, options.agent.systemPrompt, { encoding: "utf8", mode: 0o600 }),
	);
	const args = [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--no-skills",
		"--no-prompt-templates",
		"--no-extensions",
		"--tools",
		options.toolPlan.toolNames.join(","),
	];
	for (const extensionPath of options.toolPlan.extensionPaths) args.push("--extension", extensionPath);
	args.push("--model", options.model, "--thinking", options.agent.thinking);
	args.push("--append-system-prompt", promptPath);
	if (options.task.length > TASK_ARGUMENT_LIMIT) {
		const taskPath = path.join(tempDir, "task.md");
		await withFileMutationQueue(taskPath, () =>
			fs.promises.writeFile(taskPath, `Task: ${options.task}`, { encoding: "utf8", mode: 0o600 }),
		);
		args.push(`@${taskPath}`);
	} else {
		args.push(`Task: ${options.task}`);
	}
	return { args, tempDir };
}

function appendBounded(buffer: string, chunk: string, maxBytes: number): string {
	const combined = buffer + chunk;
	if (Buffer.byteLength(combined, "utf8") <= maxBytes) return combined;
	return Buffer.from(combined, "utf8").subarray(-maxBytes).toString("utf8");
}

function signalProcess(proc: ChildProcess, signal: NodeJS.Signals): void {
	if (proc.exitCode !== null || !proc.pid) return;
	try {
		if (process.platform === "win32") proc.kill(signal);
		else process.kill(-proc.pid, signal);
	} catch {
		try {
			proc.kill(signal);
		} catch {
			// The process already exited.
		}
	}
}

export async function runChild(options: ChildRunOptions): Promise<AgentRunResult> {
	const stat = await fs.promises.stat(options.cwd).catch(() => undefined);
	if (!stat?.isDirectory()) throw new Error(`Subagent cwd is not a directory: ${options.cwd}`);
	const { args, tempDir } = await buildArguments(options);
	const startedAt = Date.now();
	const result: AgentRunResult = {
		agent: options.agent.name,
		task: options.task,
		model: options.model,
		output: "",
		exitCode: -1,
		usage: emptyUsage(),
		attempts: [],
		progress: {
			status: "running",
			toolCount: 0,
			tools: [],
			lastMessage: "",
			durationMs: 0,
		},
		truncated: false,
	};
	const emitProgress = () => {
		result.progress.durationMs = Date.now() - startedAt;
		options.onProgress?.(cloneResult(result));
	};

	let abortReason: "aborted" | "timed_out" | undefined;
	let stderr = "";
	let processError: Error | undefined;
	try {
		const invocation = getPiInvocation(args);
		const exitCode = await new Promise<number>((resolve) => {
			const proc = spawn(invocation.command, invocation.args, {
				cwd: options.cwd,
				env: process.env,
				detached: process.platform !== "win32",
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdoutBuffer = "";
			let forceKillTimer: NodeJS.Timeout | undefined;
			const terminate = (reason: "aborted" | "timed_out") => {
				if (abortReason || proc.exitCode !== null) return;
				abortReason = reason;
				signalProcess(proc, "SIGTERM");
				forceKillTimer = setTimeout(() => signalProcess(proc, "SIGKILL"), KILL_GRACE_MS);
			};
			const timeout = setTimeout(() => terminate("timed_out"), options.timeoutMs);
			const onAbort = () => terminate("aborted");
			if (options.signal?.aborted) onAbort();
			else options.signal?.addEventListener("abort", onAbort, { once: true });

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: Record<string, unknown>;
				try {
					event = JSON.parse(line) as Record<string, unknown>;
				} catch {
					return;
				}
				if (event.type === "tool_execution_start") {
					result.progress.toolCount++;
					const tool: ToolEvent = {
						name: String(event.toolName ?? "tool"),
						preview: previewTool(
							(event.args && typeof event.args === "object" ? event.args : {}) as Record<string, unknown>,
						),
						status: "running",
						toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : undefined,
					};
					result.progress.tools.push(tool);
					if (result.progress.tools.length > MAX_TOOL_EVENTS) result.progress.tools.shift();
					emitProgress();
					return;
				}
				if (event.type === "tool_execution_end") {
					const id = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
					const tool = [...result.progress.tools].reverse().find((candidate) => candidate.toolCallId === id);
					if (tool) tool.status = "done";
					emitProgress();
					return;
				}
				if (event.type !== "message_end" || !event.message || typeof event.message !== "object") return;
				const message = event.message as Record<string, unknown>;
				if (message.role !== "assistant") return;
				const text = extractText(message.content);
				if (text) {
					result.output = text;
					result.progress.lastMessage = text.replace(/\s+/g, " ").trim().slice(0, 300);
				}
				const usage = message.usage as Record<string, unknown> | undefined;
				if (usage) {
					result.usage.turns++;
					result.usage.input += Number(usage.input ?? 0);
					result.usage.output += Number(usage.output ?? 0);
					result.usage.cacheRead += Number(usage.cacheRead ?? 0);
					result.usage.cacheWrite += Number(usage.cacheWrite ?? 0);
					const cost = usage.cost as Record<string, unknown> | undefined;
					result.usage.cost += Number(cost?.total ?? 0);
					result.usage.contextTokens = Number(
						usage.totalTokens ??
							Number(usage.input ?? 0) +
								Number(usage.output ?? 0) +
								Number(usage.cacheRead ?? 0) +
								Number(usage.cacheWrite ?? 0),
					);
				}
				if (typeof message.stopReason === "string") result.stopReason = message.stopReason;
				if (typeof message.errorMessage === "string") result.error = message.errorMessage;
				emitProgress();
			};

			proc.stdout.on("data", (chunk: Buffer) => {
				stdoutBuffer += chunk.toString("utf8");
				const lines = stdoutBuffer.split("\n");
				stdoutBuffer = lines.pop() ?? "";
				for (const line of lines) processLine(line);
			});
			proc.stderr.on("data", (chunk: Buffer) => {
				stderr = appendBounded(stderr, chunk.toString("utf8"), STDERR_LIMIT);
			});
			proc.on("error", (error) => {
				processError = error;
			});
			proc.on("close", (code) => {
				if (stdoutBuffer.trim()) processLine(stdoutBuffer);
				clearTimeout(timeout);
				if (forceKillTimer) clearTimeout(forceKillTimer);
				options.signal?.removeEventListener("abort", onAbort);
				resolve(code ?? 1);
			});
		});

		result.exitCode = exitCode;
		if (processError) result.error = processError.message;
		if (abortReason === "timed_out") {
			result.stopReason = "timeout";
			result.error = `Subagent exceeded timeout of ${options.timeoutMs}ms`;
			result.progress.status = "timed_out";
		} else if (abortReason === "aborted") {
			result.stopReason = "aborted";
			result.error = "Subagent was aborted";
			result.progress.status = "aborted";
		} else if (exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted") {
			result.error = result.error ?? (stderr.trim() || `Subagent exited with code ${exitCode}`);
			result.progress.status = "failed";
		} else {
			result.progress.status = "completed";
		}
		if (!result.output && result.error) result.output = `Error: ${result.error}`;
		const truncation = truncateHead(result.output || "(no output)", {
			maxBytes: DEFAULT_MAX_BYTES,
			maxLines: DEFAULT_MAX_LINES,
		});
		result.output = truncation.content;
		result.truncated = truncation.truncated;
		if (truncation.truncated) result.output += "\n\n[Output truncated]";
		result.progress.durationMs = Date.now() - startedAt;
		emitProgress();
		return result;
	} finally {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	}
}

export function isRetryableProviderFailure(result: AgentRunResult): boolean {
	if (result.progress.status === "timed_out" || result.progress.status === "aborted") return false;
	if (result.exitCode === 0 && result.stopReason !== "error") return false;
	const text = `${result.error ?? ""}\n${result.output}`;
	return /(rate.?limit|\b429\b|quota|auth|unauthori[sz]ed|forbidden|api key|provider.*unavailable|model.*(?:unavailable|disabled|not found)|overloaded|service unavailable|connection refused|network error|timed? out|timeout|\b50[234]\b)/i.test(
		text,
	);
}
