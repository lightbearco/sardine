import { PostgresStore } from "@mastra/pg";
import { env } from "#/env";

export const postgresStore = new PostgresStore({
	id: "pg-storage",
	connectionString: env.DATABASE_URL,
});
