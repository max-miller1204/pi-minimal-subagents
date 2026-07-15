import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { RegisteredToolInfo, ToolLaunchPlan } from "./types.ts";

function resolveConfiguredPath(value: string, cwd: string): string {
	if (value === "~") return os.homedir();
	if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
	return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}

function isLoadableExtensionPath(value: string): boolean {
	if (!value || value.startsWith("<")) return false;
	try {
		const stat = fs.statSync(value);
		return stat.isFile() || stat.isDirectory();
	} catch {
		return false;
	}
}

export function resolveToolLaunchPlan(
	requestedTools: string[],
	registeredTools: RegisteredToolInfo[],
	explicitMappings: Record<string, string>,
	cwd: string,
): ToolLaunchPlan {
	const toolNames = [...new Set(requestedTools.map((name) => name.trim()).filter(Boolean))];
	const extensionPaths = new Set<string>();
	const missingTools: string[] = [];
	const unloadableTools: string[] = [];

	for (const name of toolNames) {
		if (name === "subagent") {
			unloadableTools.push(name);
			continue;
		}
		const configured = explicitMappings[name];
		if (configured) {
			const configuredPath = resolveConfiguredPath(configured, cwd);
			if (isLoadableExtensionPath(configuredPath)) extensionPaths.add(configuredPath);
			else unloadableTools.push(name);
			continue;
		}

		const registered = registeredTools.find((tool) => tool.name === name);
		if (!registered) {
			missingTools.push(name);
			continue;
		}
		if (registered.sourceInfo.source === "builtin") continue;
		const sourcePath = registered.sourceInfo.path;
		if (isLoadableExtensionPath(sourcePath)) extensionPaths.add(sourcePath);
		else unloadableTools.push(name);
	}

	return {
		toolNames,
		extensionPaths: [...extensionPaths],
		missingTools,
		unloadableTools,
	};
}

export function assertToolLaunchPlan(plan: ToolLaunchPlan): void {
	if (plan.missingTools.length > 0) {
		throw new Error(
			`Required tools are not registered in the parent Pi session: ${plan.missingTools.join(", ")}`,
		);
	}
	if (plan.unloadableTools.length > 0) {
		throw new Error(
			`Required tools cannot be loaded into an isolated child process: ${plan.unloadableTools.join(", ")}. ` +
				"Configure minimalSubagents.toolExtensions with explicit extension paths if needed.",
		);
	}
}
