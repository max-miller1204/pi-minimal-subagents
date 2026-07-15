import { describe, expect, it } from "vitest";
import { renderCall } from "../src/render.ts";

const theme = {
	fg: (_color: string, value: string) => value,
	bold: (value: string) => value,
} as never;

describe("renderCall", () => {
	it("keeps collapsed calls compact", () => {
		const component = renderCall(
			{ agent: "scout", task: "Inspect the authentication flow and identify the important files" },
			theme,
			{ expanded: false },
		);
		expect(component.render(120).join("\n")).toContain("subagent scout Inspect the authentication flow");
	});
});
