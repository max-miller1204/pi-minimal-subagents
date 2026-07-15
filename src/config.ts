import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	AGENT_NAMES,
	THINKING_LEVELS,
	type AgentName,
	type AgentOverride,
	type MinimalSubagentsSettings,
	type ResolvedSettings,
} from "./types.ts";

const SETTINGS_KEY = "minimalSubagents";
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_MAX_WRITER_CONCURRENCY = 1;

const DEFAULTS: ResolvedSettings = {
	fallbackModels: [],
	allowedModels: [],
	defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
	maxConcurrency: DEFAULT_MAX_CONCURRENCY,
	maxWriterConcurrency: DEFAULT_MAX_WRITER_CONCURRENCY,
	toolExtensions: {},
	agentOverrides: {},
};

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
	if (!fs.existsSync(filePath)) return undefined;
	const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Settings file must contain a JSON object: ${filePath}`);
	}
	return parsed as Record<string, unknown>;
}

function findProjectSettings(cwd: string): string | undefined {
	let current = path.resolve(cwd);
	for (;;) {
		const candidate = path.join(current, CONFIG_DIR_NAME, "settings.json");
		if (fs.existsSync(candidate)) return candidate;
		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function stringArray(value: unknown, field: string): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
		throw new Error(`${field} must be an array of non-empty strings`);
	}
	return value.map((entry) => (entry as string).trim());
}

function positiveInteger(value: unknown, field: string): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || (value as number) <= 0) {
		throw new Error(`${field} must be a positive integer`);
	}
	return value as number;
}

function parseAgentOverride(value: unknown, field: string): AgentOverride {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${field} must be an object`);
	}
	const input = value as Record<string, unknown>;
	const result: AgentOverride = {};
	if (input.disabled !== undefined) {
		if (typeof input.disabled !== "boolean") throw new Error(`${field}.disabled must be a boolean`);
		result.disabled = input.disabled;
	}
	if (input.model !== undefined) {
		if (typeof input.model !== "string" || !input.model.trim()) {
			throw new Error(`${field}.model must be a non-empty string`);
		}
		result.model = input.model.trim();
	}
	result.fallbackModels = stringArray(input.fallbackModels, `${field}.fallbackModels`);
	if (input.thinking !== undefined) {
		if (typeof input.thinking !== "string" || !THINKING_LEVELS.includes(input.thinking as never)) {
			throw new Error(`${field}.thinking must be one of: ${THINKING_LEVELS.join(", ")}`);
		}
		result.thinking = input.thinking as AgentOverride["thinking"];
	}
	result.tools = stringArray(input.tools, `${field}.tools`);
	result.timeoutMs = positiveInteger(input.timeoutMs, `${field}.timeoutMs`);
	return result;
}

function parseSettingsSection(value: unknown, source: string): MinimalSubagentsSettings {
	if (value === undefined) return {};
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${source}.${SETTINGS_KEY} must be an object`);
	}
	const input = value as Record<string, unknown>;
	const result: MinimalSubagentsSettings = {};
	if (input.defaultModel !== undefined) {
		if (typeof input.defaultModel !== "string" || !input.defaultModel.trim()) {
			throw new Error(`${source}.${SETTINGS_KEY}.defaultModel must be a non-empty string`);
		}
		result.defaultModel = input.defaultModel.trim();
	}
	result.fallbackModels = stringArray(input.fallbackModels, `${source}.${SETTINGS_KEY}.fallbackModels`);
	result.allowedModels = stringArray(input.allowedModels, `${source}.${SETTINGS_KEY}.allowedModels`);
	result.defaultTimeoutMs = positiveInteger(
		input.defaultTimeoutMs,
		`${source}.${SETTINGS_KEY}.defaultTimeoutMs`,
	);
	result.maxConcurrency = positiveInteger(input.maxConcurrency, `${source}.${SETTINGS_KEY}.maxConcurrency`);
	result.maxWriterConcurrency = positiveInteger(
		input.maxWriterConcurrency,
		`${source}.${SETTINGS_KEY}.maxWriterConcurrency`,
	);
	if (input.toolExtensions !== undefined) {
		if (
			!input.toolExtensions ||
			typeof input.toolExtensions !== "object" ||
			Array.isArray(input.toolExtensions)
		) {
			throw new Error(`${source}.${SETTINGS_KEY}.toolExtensions must be an object`);
		}
		result.toolExtensions = {};
		for (const [name, extensionPath] of Object.entries(input.toolExtensions)) {
			if (!name.trim() || typeof extensionPath !== "string" || !extensionPath.trim()) {
				throw new Error(`${source}.${SETTINGS_KEY}.toolExtensions entries must map names to paths`);
			}
			result.toolExtensions[name] = extensionPath.trim();
		}
	}
	if (input.agentOverrides !== undefined) {
		if (
			!input.agentOverrides ||
			typeof input.agentOverrides !== "object" ||
			Array.isArray(input.agentOverrides)
		) {
			throw new Error(`${source}.${SETTINGS_KEY}.agentOverrides must be an object`);
		}
		result.agentOverrides = {};
		for (const [name, override] of Object.entries(input.agentOverrides)) {
			if (!AGENT_NAMES.includes(name as AgentName)) {
				throw new Error(`${source}.${SETTINGS_KEY}.agentOverrides has unknown agent: ${name}`);
			}
			result.agentOverrides[name as AgentName] = parseAgentOverride(
				override,
				`${source}.${SETTINGS_KEY}.agentOverrides.${name}`,
			);
		}
	}
	return result;
}

function mergeSettings(base: ResolvedSettings, next: MinimalSubagentsSettings): ResolvedSettings {
	const agentOverrides = { ...base.agentOverrides };
	for (const name of AGENT_NAMES) {
		const override = next.agentOverrides?.[name];
		if (override) agentOverrides[name] = { ...agentOverrides[name], ...override };
	}
	return {
		defaultModel: next.defaultModel ?? base.defaultModel,
		fallbackModels: next.fallbackModels ?? base.fallbackModels,
		allowedModels: next.allowedModels ?? base.allowedModels,
		defaultTimeoutMs: next.defaultTimeoutMs ?? base.defaultTimeoutMs,
		maxConcurrency: next.maxConcurrency ?? base.maxConcurrency,
		maxWriterConcurrency: next.maxWriterConcurrency ?? base.maxWriterConcurrency,
		toolExtensions: { ...base.toolExtensions, ...next.toolExtensions },
		agentOverrides,
	};
}

export function loadSettings(cwd: string, projectTrusted: boolean): ResolvedSettings {
	const userPath = path.join(getAgentDir(), "settings.json");
	const user = readJsonObject(userPath);
	let result = mergeSettings(DEFAULTS, parseSettingsSection(user?.[SETTINGS_KEY], userPath));
	if (!projectTrusted) return result;
	const projectPath = findProjectSettings(cwd);
	if (!projectPath) return result;
	const project = readJsonObject(projectPath);
	result = mergeSettings(result, parseSettingsSection(project?.[SETTINGS_KEY], projectPath));
	return result;
}

export function modelMatchesAllowedPatterns(model: string, patterns: string[]): boolean {
	if (patterns.length === 0) return true;
	return patterns.some((pattern) => {
		const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
		return new RegExp(`^${escaped}$`, "i").test(model);
	});
}

export function assertModelAllowed(model: string, patterns: string[]): void {
	if (!modelMatchesAllowedPatterns(model, patterns)) {
		throw new Error(`Model '${model}' is outside minimalSubagents.allowedModels (${patterns.join(", ")})`);
	}
}
