export type ChatRequestContextValues = {
	"session-id"?: string;
};

export function resolveChatSessionId(input: {
	sessionId?: string;
	requestContext?: {
		get: (key: "session-id") => unknown;
	};
}): string {
	const sessionId = input.sessionId ?? input.requestContext?.get("session-id");

	if (typeof sessionId !== "string" || sessionId.length === 0) {
		throw new Error("sessionId is required");
	}

	return sessionId;
}
