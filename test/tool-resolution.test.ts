import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertToolLaunchPlan, resolveToolLaunchPlan } from "../src/tool-resolution.ts";
import type { RegisteredToolInfo } from "../src/types.ts";

function tool(name: string, source: string, path: string): RegisteredToolInfo {
	return { name, description: name, sourceInfo: { source, path } };
}

describe("tool launch resolution", () => {
	it("keeps builtins and discovers custom extension paths from the live registry", () => {
		const directory = mkdtempSync(join(tmpdir(), "pi-minimal-tools-"));
		const extensionPath = join(directory, "web.ts");
		writeFileSync(extensionPath, "export default () => {};\n");
		const plan = resolveToolLaunchPlan(
			["read", "fetch_content", "fetch_content"],
			[tool("read", "builtin", "<builtin:read>"), tool("fetch_content", "extension", extensionPath)],
			{},
			directory,
		);
		expect(plan).toEqual({
			toolNames: ["read", "fetch_content"],
			extensionPaths: [extensionPath],
			missingTools: [],
			unloadableTools: [],
		});
		expect(() => assertToolLaunchPlan(plan)).not.toThrow();
	});

	it("uses explicit mappings when registry provenance is not loadable", () => {
		const directory = mkdtempSync(join(tmpdir(), "pi-minimal-tools-"));
		const extensionPath = join(directory, "custom.ts");
		writeFileSync(extensionPath, "export default () => {};\n");
		const plan = resolveToolLaunchPlan(
			["custom_tool"],
			[tool("custom_tool", "sdk", "<sdk:custom_tool>")],
			{ custom_tool: extensionPath },
			directory,
		);
		expect(plan.extensionPaths).toEqual([extensionPath]);
		expect(plan.unloadableTools).toEqual([]);
	});

	it("fails closed for missing, unloadable, and recursive tools", () => {
		const plan = resolveToolLaunchPlan(
			["missing", "sdk_tool", "subagent"],
			[tool("sdk_tool", "sdk", "<sdk:sdk_tool>")],
			{},
			process.cwd(),
		);
		expect(plan.missingTools).toEqual(["missing"]);
		expect(plan.unloadableTools).toEqual(["sdk_tool", "subagent"]);
		expect(() => assertToolLaunchPlan(plan)).toThrow("Required tools are not registered");
	});
});
