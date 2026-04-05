import { config } from "dotenv";
import z from "zod";

config({ path: ".env.local" });

export const envSchema = z.object({
	DATABASE_URL: z.string(),
	BETTER_AUTH_URL: z.string(),
	BETTER_AUTH_SECRET: z.string(),
	GOOGLE_CLIENT_ID: z.string(),
	GOOGLE_CLIENT_SECRET: z.string(),

	GOOGLE_GENERATIVE_AI_API_KEY: z.string(),

	ANTHROPIC_API_KEY: z.string().optional(),
	FIRECRAWL_API_KEY: z.string().optional(),
	FIRECRAWL_MOCK_MODE: z.string().optional(),
	ALPACA_BASE_URL: z.string().optional(),
	ALPACA_API_KEY: z.string().optional(),
	ALPACA_API_SECRET: z.string().optional(),
	SIM_MAX_LIVE_SESSIONS: z.string().optional(),
});

export const alpacaEnvSchema = z.object({
	ALPACA_BASE_URL: z.string(),
	ALPACA_API_KEY: z.string(),
	ALPACA_API_SECRET: z.string(),
});

export const googleGenerativeAIEnvSchema = envSchema.pick({
	GOOGLE_GENERATIVE_AI_API_KEY: true,
});

export type Env = z.infer<typeof envSchema>;
export type GoogleGenerativeAIEnv = z.infer<typeof googleGenerativeAIEnvSchema>;
export type AlpacaEnv = z.infer<typeof alpacaEnvSchema>;

let cachedEnv: Env | undefined;

export function getEnv(input: NodeJS.ProcessEnv = process.env): Env {
	if (input === process.env) {
		cachedEnv ??= envSchema.parse(input);
		return cachedEnv;
	}

	return envSchema.parse(input);
}

export const env = new Proxy({} as Env, {
	get(_target, property) {
		return getEnv()[property as keyof Env];
	},
});

export function hasGoogleGenerativeAIEnv(
	input: NodeJS.ProcessEnv = process.env,
): boolean {
	return googleGenerativeAIEnvSchema.safeParse(input).success;
}

export function getGoogleGenerativeAIEnv(
	input: NodeJS.ProcessEnv = process.env,
): GoogleGenerativeAIEnv {
	return googleGenerativeAIEnvSchema.parse(input);
}

export function hasAlpacaEnv(
	input: NodeJS.ProcessEnv = process.env,
): boolean {
	return alpacaEnvSchema.safeParse(input).success;
}

export function getAlpacaEnv(
	input: NodeJS.ProcessEnv = process.env,
): AlpacaEnv {
	return alpacaEnvSchema.parse(input);
}
