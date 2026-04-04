import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
	getGoogleGenerativeAIEnv,
} from "#/env";

let cachedGoogleProvider:
	| ReturnType<typeof createGoogleGenerativeAI>
	| undefined;

export { hasGoogleGenerativeAIEnv } from "#/env";

export function getGoogleGeminiProvider(): ReturnType<
	typeof createGoogleGenerativeAI
> {
	if (cachedGoogleProvider) {
		return cachedGoogleProvider;
	}

	const env = getGoogleGenerativeAIEnv();
	cachedGoogleProvider = createGoogleGenerativeAI({
		apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
	});

	return cachedGoogleProvider;
}
