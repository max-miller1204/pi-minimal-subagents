import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isRetryableProviderFailure, runChild } from "../src/process.ts";
import type { ChildRunOptions, ResolvedAgent } from "../src/types.ts";

const agent: ResolvedAgent = {
	name: "scout",
	description: "test scout",
	tools: ["read"],
	thinking: "low",
	writer: false,
	systemPrompt: "Return a concise result.",
	filePath: "agents/scout.md",
	disabled: false,
	fallbackModels: [],
	timeoutMs: 5_000,
};

function options(task: string, timeoutMs = 5_000): ChildRunOptions {
	return {
		agent,
		model: "test/fake",
		task,
		cwd: process.cwd(),
		timeoutMs,
		toolPlan: { toolNames: ["read"], extensionPaths: [], missingTools: [], unloadableTools: [] },
	};
}

beforeEach(() => {
	process.env.PI_MINIMAL_SUBAGENTS_PI_ENTRY = resolve("test/fixtures/fake-pi.mjs");
});

afterEach(() => {
	delete process.env.PI_MINIMAL_SUBAGENTS_PI_ENTRY;
});

describe("child process runner", () => {
	it("captures progress, output, and usage", async () => {
		const updates: string[] = [];
		const result = await runChild({
			...options("normal"),
			onProgress: (progress) => updates.push(progress.progress.status),
		});
		expect(result.progress.status).toBe("completed");
		expect(result.output).toBe("fake child completed");
		expect(result.progress.toolCount).toBe(1);
		expect(result.progress.tools[0]).toMatchObject({ name: "read", status: "done" });
		expect(result.usage).toMatchObject({ input: 10, output: 4, cacheRead: 2, turns: 1 });
		expect(updates).toContain("completed");
	});

	it("truncates large model-visible output", async () => {
		const result = await runChild(options("LARGE_OUTPUT"));
		expect(result.truncated).toBe(true);
		expect(Buffer.byteLength(result.output, "utf8")).toBeLessThan(52 * 1024);
	});

	it("classifies provider failures for fallback", async () => {
		const result = await runChild(options("FAIL_PROVIDER"));
		expect(result.progress.status).toBe("failed");
		expect(isRetryableProviderFailure(result)).toBe(true);
	});

	it("terminates children at the hard timeout", async () => {
		const result = await runChild(options("SLEEP", 100));
		expect(result.progress.status).toBe("timed_out");
		expect(result.error).toContain("exceeded timeout");
		expect(isRetryableProviderFailure(result)).toBe(false);
	});
});
