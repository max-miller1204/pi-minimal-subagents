import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import {
	AGENT_NAMES,
	THINKING_LEVELS,
	type AgentDefinition,
	type AgentName,
	type ResolvedAgent,
	type ResolvedSettings,
	type ThinkingLevel,
} from "./types.ts";

const AGENTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "agents");

function parseBoolean(value: unknown, field: string): boolean {
	if (value === true || value === "true") return true;
	if (value === false || value === "false" || value === undefined) return false;
	throw new Error(`${field} must be true or false`);
}

function parseTools(value: unknown, filePath: string): string[] {
	const raw = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
	const tools = raw
		.filter((tool): tool is string => typeof tool === "string")
		.map((tool) => tool.trim())
		.filter(Boolean);
	if (tools.length === 0) throw new Error(`Agent must declare tools in ${filePath}`);
	return tools;
}

function loadAgentFile(filePath: string): AgentDefinition {
	const content = fs.readFileSync(filePath, "utf8");
	const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
	const name = typeof frontmatter.name === "string" ? (frontmatter.name as AgentName) : undefined;
	if (!name || !AGENT_NAMES.includes(name)) throw new Error(`Invalid agent name in ${filePath}`);
	const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
	if (!description) throw new Error(`Missing description in ${filePath}`);
	const tools = parseTools(frontmatter.tools, filePath);
	const thinking = (
		typeof frontmatter.thinking === "string" ? frontmatter.thinking : "medium"
	) as ThinkingLevel;
	if (!THINKING_LEVELS.includes(thinking)) throw new Error(`Invalid thinking level in ${filePath}`);
	if (!body.trim()) throw new Error(`Missing system prompt in ${filePath}`);
	return {
		name,
		description,
		tools,
		thinking,
		writer: parseBoolean(frontmatter.writer, `${filePath}: writer`),
		systemPrompt: body.trim(),
		filePath,
	};
}

export function loadBundledAgents(agentsDir = AGENTS_DIR): AgentDefinition[] {
	const agents = AGENT_NAMES.map((name) => loadAgentFile(path.join(agentsDir, `${name}.md`)));
	const names = new Set(agents.map((agent) => agent.name));
	if (names.size !== AGENT_NAMES.length) throw new Error("Bundled agent names must be unique");
	return agents;
}

export function resolveAgents(
	settings: ResolvedSettings,
	definitions = loadBundledAgents(),
): ResolvedAgent[] {
	return definitions.map((definition) => {
		const override = settings.agentOverrides[definition.name];
		return {
			...definition,
			disabled: override?.disabled ?? false,
			model: override?.model ?? settings.defaultModel,
			fallbackModels: override?.fallbackModels ?? settings.fallbackModels,
			thinking: override?.thinking ?? definition.thinking,
			tools: override?.tools ?? definition.tools,
			timeoutMs: override?.timeoutMs ?? settings.defaultTimeoutMs,
		};
	});
}

export function getExecutableAgent(agents: ResolvedAgent[], name: string): ResolvedAgent {
	const agent = agents.find((candidate) => candidate.name === name);
	if (!agent) throw new Error(`Unknown agent '${name}'. Available agents: ${AGENT_NAMES.join(", ")}`);
	if (agent.disabled) throw new Error(`Agent '${name}' is disabled in minimalSubagents.agentOverrides`);
	return agent;
}
