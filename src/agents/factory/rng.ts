export function createSeededRandom(seed: number) {
	let state = seed >>> 0;

	const next = () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 2 ** 32;
	};

	return {
		float(min: number, max: number) {
			return min + next() * (max - min);
		},
		int(min: number, max: number) {
			return Math.floor(this.float(min, max + 1));
		},
		pick<T>(items: readonly T[]): T {
			return items[this.int(0, items.length - 1)];
		},
		sample<T>(items: readonly T[], count: number): T[] {
			const pool = [...items];
			const result: T[] = [];

			while (pool.length > 0 && result.length < count) {
				result.push(pool.splice(this.int(0, pool.length - 1), 1)[0]);
			}

			return result;
		},
	};
}
