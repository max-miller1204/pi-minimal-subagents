import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { getMarkdownTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import type { SubagentToolDetails } from "./types.ts";

type Theme = ExtensionContext["ui"]["theme"];

interface CallArguments {
	agent?: string;
	task?: string;
	cwd?: string;
}

interface RenderCallContext {
	expanded: boolean;
}

interface RenderResultOptions {
	expanded: boolean;
	isPartial: boolean;
}

function formatNumber(value: number): string {
	if (value < 1_000) return String(value);
	if (value < 10_000) return `${(value / 1_000).toFixed(1)}k`;
	if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
	return `${(value / 1_000_000).toFixed(1)}m`;
}

function formatDuration(milliseconds: number): string {
	if (milliseconds < 1_000) return `${milliseconds}ms`;
	if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)}s`;
	return `${Math.floor(milliseconds / 60_000)}m${Math.floor((milliseconds % 60_000) / 1_000)}s`;
}

function usageLine(details: SubagentToolDetails, theme: Theme): string {
	const { usage, model, progress, attempts } = details.result;
	const parts = [
		`${progress.toolCount} tools`,
		formatDuration(progress.durationMs),
		`up ${formatNumber(usage.input)}`,
		`down ${formatNumber(usage.output)}`,
	];
	if (usage.cacheRead) parts.push(`cache ${formatNumber(usage.cacheRead)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens) parts.push(`ctx ${formatNumber(usage.contextTokens)}`);
	if (attempts.length > 1) parts.push(`${attempts.length} model attempts`);
	parts.push(model);
	return theme.fg("dim", parts.join(" | "));
}

export function renderCall(args: CallArguments, theme: Theme, context: RenderCallContext): Text | Container {
	const agent = args.agent ?? "...";
	const header = `${theme.fg("toolTitle", theme.bold("subagent"))} ${theme.fg("accent", agent)}`;
	if (!context.expanded) {
		const preview = (args.task ?? "...").replace(/\s+/g, " ");
		return new Text(
			`${header} ${theme.fg("dim", preview.length > 72 ? `${preview.slice(0, 72)}...` : preview)}`,
			0,
			0,
		);
	}
	const container = new Container();
	container.addChild(new Text(`${header}${args.cwd ? theme.fg("dim", ` (${args.cwd})`) : ""}`, 0, 0));
	if (args.task) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(args.task, 0, 0));
	}
	return container;
}

export function renderResult(
	result: AgentToolResult<SubagentToolDetails>,
	options: RenderResultOptions,
	theme: Theme,
): Text | Container | Markdown {
	const details = result.details;
	if (!details?.result) {
		const content = result.content.find((part) => part.type === "text");
		return new Text(content?.type === "text" ? content.text : "(no output)", 0, 0);
	}
	const run = details.result;
	const running = options.isPartial || run.progress.status === "queued" || run.progress.status === "running";
	const icon = running
		? theme.fg("warning", "*")
		: run.progress.status === "completed"
			? theme.fg("success", "+")
			: theme.fg("error", "x");
	const container = new Container();
	container.addChild(
		new Text(
			`${icon} ${theme.fg("toolTitle", theme.bold(run.agent))} ${theme.fg("dim", `[${run.progress.status}]`)}`,
			0,
			0,
		),
	);
	for (const tool of run.progress.tools) {
		const marker = tool.status === "running" ? ">" : " ";
		container.addChild(
			new Text(
				theme.fg(tool.status === "running" ? "warning" : "muted", `${marker} ${tool.name}: ${tool.preview}`),
				0,
				0,
			),
		);
	}
	if (options.expanded && !running && run.output) {
		container.addChild(new Spacer(1));
		container.addChild(new Markdown(run.output, 0, 0, getMarkdownTheme()));
	} else if (run.progress.lastMessage) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(run.progress.lastMessage, 0, 0));
	}
	container.addChild(new Spacer(1));
	container.addChild(new Text(usageLine(details, theme), 0, 0));
	if (run.error) container.addChild(new Text(theme.fg("error", `Error: ${run.error}`), 0, 0));
	return container;
}
