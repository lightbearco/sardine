import { Agent } from "@mastra/core/agent";
import { CHATBOT_SYSTEM_PROMPT } from "#/mastra/prompts/chatbot";
import { TRADING_MODEL } from "#/mastra/models";
import { eventInjectionTool } from "#/mastra/tools/eventInjectionTool";
import { marketDataTool } from "#/mastra/tools/marketDataTool";
import { simQueryTool } from "#/mastra/tools/simQueryTool";
import { waitAndObserveTool } from "#/mastra/tools/waitAndObserveTool";

export const chatbotAgent = new Agent({
	id: "chatbot-agent",
	name: "Chatbot Agent",
	description:
		"A what-if scenario assistant that injects world events into the simulation and observes how AI trading agents react.",
	instructions: CHATBOT_SYSTEM_PROMPT,
	model: TRADING_MODEL,
	tools: {
		eventInjectionTool,
		waitAndObserveTool,
		simQueryTool,
		marketDataTool,
	},
});
