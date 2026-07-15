import { describe, expect, it } from "vitest";
import { loadBundledAgents, resolveAgents } from "../src/agents.ts";
import type { ResolvedSettings } from "../src/types.ts";

const settings: ResolvedSettings = {
	fallbackModels: ["provider/fallback"],
	allowedModels: ["provider/*"],
	defaultModel: "provider/default",
	defaultTimeoutMs: 60_000,
	maxConcurrency: 4,
	maxWriterConcurrency: 1,
	toolExtensions: {},
	agentOverrides: {
		reviewer: {
			model: "provider/reviewer",
			tools: ["read", "fetch_content"],
		},
	},
};

describe("bundled agents", () => {
	it("loads exactly scout, reviewer, and worker", () => {
		const agents = loadBundledAgents();
		expect(agents.map((agent) => agent.name)).toEqual(["scout", "reviewer", "worker"]);
		expect(agents.find((agent) => agent.name === "worker")?.writer).toBe(true);
		expect(agents.filter((agent) => agent.name !== "worker").every((agent) => !agent.writer)).toBe(true);
	});

	it("applies settings overrides without changing role prompts", () => {
		const agents = resolveAgents(settings);
		const reviewer = agents.find((agent) => agent.name === "reviewer");
		expect(reviewer).toMatchObject({
			model: "provider/reviewer",
			tools: ["read", "fetch_content"],
			fallbackModels: ["provider/fallback"],
			timeoutMs: 60_000,
		});
		expect(reviewer?.systemPrompt).toContain("independent reviewer");
	});
});
