import { PgVector } from "@mastra/pg";
import { env } from "#/env";

export const pgVector = new PgVector({
	id: "pg_vector",
	connectionString: env.DATABASE_URL,
});
