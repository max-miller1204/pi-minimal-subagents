import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const children: ChildProcessWithoutNullStreams[] = [];

afterEach(() => {
	for (const child of children.splice(0)) child.kill("SIGTERM");
});

function rpc(child: ChildProcessWithoutNullStreams, request: object): Promise<Record<string, unknown>> {
	return new Promise((resolveResponse, reject) => {
		let buffer = "";
		const timer = setTimeout(() => reject(new Error("RPC response timed out")), 20_000);
		child.stdout.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			for (;;) {
				const newline = buffer.indexOf("\n");
				if (newline < 0) break;
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				if (!line.trim()) continue;
				const value = JSON.parse(line) as Record<string, unknown>;
				if (value.type === "extension_error") {
					clearTimeout(timer);
					reject(new Error(JSON.stringify(value)));
				}
				if (value.type === "response" && value.id === "test") {
					clearTimeout(timer);
					resolveResponse(value);
				}
			}
		});
		child.stdin.write(`${JSON.stringify({ id: "test", ...request })}\n`);
	});
}

describe("real Pi load", () => {
	it("loads the package and registers the diagnostic command", async () => {
		const child = spawn(
			"pi",
			[
				"--mode",
				"rpc",
				"--offline",
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--no-themes",
				"--no-context-files",
				"--no-session",
				"-e",
				resolve("."),
			],
			{ cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] },
		);
		children.push(child);
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		const response = await rpc(child, { type: "get_commands" });
		expect(response.success, stderr).toBe(true);
		const data = response.data as { commands: Array<{ name: string; sourceInfo?: { path?: string } }> };
		const command = data.commands.find((candidate) => candidate.name === "minimal-subagents");
		expect(command?.sourceInfo?.path).toContain("src/extension.ts");
	});
});
