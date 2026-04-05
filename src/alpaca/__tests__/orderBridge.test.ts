import { describe, expect, it, vi } from "vitest";
import { submitSimSignalToAlpaca } from "#/alpaca/orderBridge";

describe("orderBridge", () => {
	it("returns a not_configured result when no client is available", async () => {
		const result = await submitSimSignalToAlpaca(
			{
				symbol: "AAPL",
				side: "buy",
				type: "market",
				qty: 10,
			},
			null,
		);

		expect(result).toEqual({
			status: "not_configured",
			orderId: null,
			clientOrderId: null,
			message: "Alpaca is not configured; skipped paper order submission.",
		});
	});

	it("submits validated market and limit signals", async () => {
		const client = {
			submitOrder: vi.fn().mockResolvedValue({
				id: "order-1",
				clientOrderId: "sim:agent:AAPL:buy",
				status: "accepted",
			}),
		};

		const result = await submitSimSignalToAlpaca(
			{
				symbol: "AAPL",
				side: "buy",
				type: "limit",
				qty: 5,
				limitPrice: 101.25,
				sourceSessionId: "sim",
				sourceAgentId: "agent",
			},
			client as never,
		);

		expect(client.submitOrder).toHaveBeenCalledWith(
			expect.objectContaining({
				symbol: "AAPL",
				side: "buy",
				type: "limit",
				qty: 5,
				limitPrice: 101.25,
			}),
		);
		expect(result.status).toBe("submitted");
		expect(result.orderId).toBe("order-1");
	});

	it("rejects limit orders without a limit price", async () => {
		await expect(
			submitSimSignalToAlpaca(
				{
					symbol: "AAPL",
					side: "buy",
					type: "limit",
					qty: 5,
				},
				{
					submitOrder: vi.fn(),
				} as never,
			),
		).rejects.toThrow("limitPrice is required for limit orders");
	});
});
