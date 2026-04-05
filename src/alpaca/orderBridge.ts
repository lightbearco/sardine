import { z } from "zod";
import {
	createAlpacaClient,
	hasAlpacaEnv,
	type AlpacaClient,
} from "#/alpaca/client";

export const alpacaOrderSignalSchema = z
	.object({
		symbol: z.string().min(1),
		side: z.enum(["buy", "sell"]),
		type: z.enum(["market", "limit"]),
		qty: z.number().int().positive(),
		limitPrice: z.number().positive().optional(),
		sourceAgentId: z.string().min(1).optional(),
		sourceSessionId: z.string().min(1).optional(),
	})
	.superRefine((input, context) => {
		if (input.type === "limit" && input.limitPrice === undefined) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "limitPrice is required for limit orders",
				path: ["limitPrice"],
			});
		}
	});

export type AlpacaOrderSignal = z.infer<typeof alpacaOrderSignalSchema>;

export interface AlpacaOrderBridgeResult {
	status: "submitted" | "not_configured";
	orderId: string | null;
	clientOrderId: string | null;
	message: string;
}

function buildClientOrderId(signal: AlpacaOrderSignal): string | undefined {
	if (!signal.sourceAgentId && !signal.sourceSessionId) {
		return undefined;
	}

	const parts = [
		signal.sourceSessionId ?? "sim",
		signal.sourceAgentId ?? "agent",
		signal.symbol,
		signal.side,
		Date.now().toString(36),
	];
	return parts.join(":").slice(0, 48);
}

export async function submitSimSignalToAlpaca(
	signal: AlpacaOrderSignal,
	client: AlpacaClient | null = hasAlpacaEnv() ? createAlpacaClient() : null,
): Promise<AlpacaOrderBridgeResult> {
	const parsed = alpacaOrderSignalSchema.parse(signal);

	if (!client) {
		return {
			status: "not_configured",
			orderId: null,
			clientOrderId: null,
			message: "Alpaca is not configured; skipped paper order submission.",
		};
	}

	const result = await client.submitOrder({
		symbol: parsed.symbol,
		side: parsed.side,
		type: parsed.type,
		qty: parsed.qty,
		limitPrice: parsed.limitPrice,
		clientOrderId: buildClientOrderId(parsed),
	});

	console.log(
		`[Alpaca] Submitted ${parsed.type} ${parsed.side} ${parsed.qty} ${parsed.symbol}: ${result.id} (${result.status})`,
	);

	return {
		status: "submitted",
		orderId: result.id,
		clientOrderId: result.clientOrderId,
		message: `Submitted Alpaca paper order ${result.id} with status ${result.status}.`,
	};
}
