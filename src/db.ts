import { neon } from "@neondatabase/serverless";
import { env } from "#/env";

let client: ReturnType<typeof neon>;

export async function getClient() {
	if (!env.DATABASE_URL) {
		return undefined;
	}
	if (!client) {
		client = await neon(env.DATABASE_URL);
	}
	return client;
}
