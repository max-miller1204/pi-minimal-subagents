export const AGENT_NAMES = ["scout", "reviewer", "worker"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface AgentDefinition {
	name: AgentName;
	description: string;
	tools: string[];
	thinking: ThinkingLevel;
	writer: boolean;
	systemPrompt: string;
	filePath: string;
}

export interface AgentOverride {
	disabled?: boolean;
	model?: string;
	fallbackModels?: string[];
	thinking?: ThinkingLevel;
	tools?: string[];
	timeoutMs?: number;
}

export interface MinimalSubagentsSettings {
	defaultModel?: string;
	fallbackModels?: string[];
	allowedModels?: string[];
	defaultTimeoutMs?: number;
	maxConcurrency?: number;
	maxWriterConcurrency?: number;
	toolExtensions?: Record<string, string>;
	agentOverrides?: Partial<Record<AgentName, AgentOverride>>;
}

export interface ResolvedAgent extends AgentDefinition {
	disabled: boolean;
	model?: string;
	fallbackModels: string[];
	timeoutMs: number;
}

export interface ResolvedSettings {
	defaultModel?: string;
	fallbackModels: string[];
	allowedModels: string[];
	defaultTimeoutMs: number;
	maxConcurrency: number;
	maxWriterConcurrency: number;
	toolExtensions: Record<string, string>;
	agentOverrides: Partial<Record<AgentName, AgentOverride>>;
}

export interface ToolSourceInfo {
	path: string;
	source: string;
	scope?: string;
	origin?: string;
}

export interface RegisteredToolInfo {
	name: string;
	description: string;
	sourceInfo: ToolSourceInfo;
}

export interface ToolLaunchPlan {
	toolNames: string[];
	extensionPaths: string[];
	missingTools: string[];
	unloadableTools: string[];
}

export interface ToolEvent {
	name: string;
	preview: string;
	status: "running" | "done";
	toolCallId?: string;
}

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface ModelAttempt {
	model: string;
	exitCode: number;
	stopReason?: string;
	error?: string;
	usage: UsageStats;
}

export interface AgentProgress {
	status: "queued" | "running" | "completed" | "failed" | "timed_out" | "aborted";
	toolCount: number;
	tools: ToolEvent[];
	lastMessage: string;
	durationMs: number;
}

export interface AgentRunResult {
	agent: AgentName;
	task: string;
	model: string;
	output: string;
	exitCode: number;
	stopReason?: string;
	error?: string;
	usage: UsageStats;
	attempts: ModelAttempt[];
	progress: AgentProgress;
	truncated: boolean;
}

export interface SubagentToolDetails {
	result: AgentRunResult;
}

export interface ChildRunOptions {
	agent: ResolvedAgent;
	model: string;
	task: string;
	cwd: string;
	timeoutMs: number;
	toolPlan: ToolLaunchPlan;
	signal?: AbortSignal;
	onProgress?: (result: AgentRunResult) => void;
}
