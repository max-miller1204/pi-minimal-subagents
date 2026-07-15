import { describe, expect, it } from "vitest";
import { assertModelAllowed, modelMatchesAllowedPatterns } from "../src/config.ts";

describe("model allowlist", () => {
	it("supports case-insensitive star patterns", () => {
		expect(modelMatchesAllowedPatterns("opencode-go/kimi-k2.7-code", ["opencode-go/*"])).toBe(true);
		expect(modelMatchesAllowedPatterns("OpenCode-Go/Qwen", ["opencode-go/*"])).toBe(true);
		expect(modelMatchesAllowedPatterns("anthropic/claude", ["opencode-go/*"])).toBe(false);
	});

	it("allows every model when no patterns are configured", () => {
		expect(modelMatchesAllowedPatterns("any/model", [])).toBe(true);
	});

	it("reports rejected models", () => {
		expect(() => assertModelAllowed("anthropic/claude", ["opencode-go/*"])).toThrow(
			"outside minimalSubagents.allowedModels",
		);
	});
});
