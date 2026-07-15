import { describe, expect, it } from "vitest";
import { Semaphore } from "../src/semaphore.ts";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("Semaphore", () => {
	it("serializes work at the configured limit", async () => {
		const semaphore = new Semaphore(1);
		const gate = deferred<void>();
		const order: string[] = [];
		const first = semaphore.run(async () => {
			order.push("first-start");
			await gate.promise;
			order.push("first-end");
		});
		const second = semaphore.run(async () => {
			order.push("second-start");
		});
		await Promise.resolve();
		expect(order).toEqual(["first-start"]);
		gate.resolve();
		await Promise.all([first, second]);
		expect(order).toEqual(["first-start", "first-end", "second-start"]);
	});

	it("removes aborted waiters without consuming a slot", async () => {
		const semaphore = new Semaphore(1);
		const release = await semaphore.acquire();
		const controller = new AbortController();
		const waiting = semaphore.acquire(controller.signal);
		controller.abort();
		await expect(waiting).rejects.toThrow("aborted");
		release();
		const nextRelease = await semaphore.acquire();
		nextRelease();
	});
});
