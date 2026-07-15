const args = process.argv.slice(2);
const task = args.at(-1) ?? "";

if (task.includes("SLEEP")) {
	setInterval(() => {}, 1000);
} else if (task.includes("FAIL_PROVIDER")) {
	process.stderr.write("429 rate limit from provider\n");
	process.exitCode = 1;
} else {
	process.stdout.write(
		`${JSON.stringify({
			type: "tool_execution_start",
			toolName: "read",
			toolCallId: "tool-1",
			args: { path: "README.md" },
		})}\n`,
	);
	process.stdout.write(
		`${JSON.stringify({
			type: "tool_execution_end",
			toolName: "read",
			toolCallId: "tool-1",
		})}\n`,
	);
	const output = task.includes("LARGE_OUTPUT") ? "x".repeat(60 * 1024) : "fake child completed";
	process.stdout.write(
		`${JSON.stringify({
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: output }],
				model: "test/fake",
				stopReason: "end",
				usage: {
					input: 10,
					output: 4,
					cacheRead: 2,
					cacheWrite: 0,
					totalTokens: 16,
					cost: { total: 0.001 },
				},
			},
		})}\n`,
	);
}
