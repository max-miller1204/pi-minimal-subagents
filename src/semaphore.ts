interface Waiter {
	resolve: (release: () => void) => void;
	reject: (error: Error) => void;
	signal?: AbortSignal;
	onAbort?: () => void;
}

export class Semaphore {
	private active = 0;
	private readonly waiters: Waiter[] = [];

	constructor(private readonly limit: number) {
		if (!Number.isInteger(limit) || limit <= 0) throw new Error("Semaphore limit must be a positive integer");
	}

	async acquire(signal?: AbortSignal): Promise<() => void> {
		if (signal?.aborted) throw new Error("Operation aborted while waiting for a concurrency slot");
		if (this.active < this.limit) return this.takeSlot();
		return new Promise<() => void>((resolve, reject) => {
			const waiter: Waiter = { resolve, reject, signal };
			if (signal) {
				waiter.onAbort = () => {
					const index = this.waiters.indexOf(waiter);
					if (index >= 0) this.waiters.splice(index, 1);
					reject(new Error("Operation aborted while waiting for a concurrency slot"));
				};
				signal.addEventListener("abort", waiter.onAbort, { once: true });
			}
			this.waiters.push(waiter);
		});
	}

	async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		const release = await this.acquire(signal);
		try {
			return await fn();
		} finally {
			release();
		}
	}

	private takeSlot(): () => void {
		this.active++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.active--;
			this.startNext();
		};
	}

	private startNext(): void {
		const waiter = this.waiters.shift();
		if (!waiter) return;
		if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
		if (waiter.signal?.aborted) {
			waiter.reject(new Error("Operation aborted while waiting for a concurrency slot"));
			this.startNext();
			return;
		}
		waiter.resolve(this.takeSlot());
	}
}
