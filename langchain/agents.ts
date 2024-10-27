import { callModel } from "./model.ts";
import { ChatPromptTemplate } from "npm:@langchain/core/prompts";

export async function analyzeConversationWithAgent(
    conversation: string,
): Promise<string> {
    const formattedPrompt = await ChatPromptTemplate.fromTemplate(`
    You are a Detective analyzing the sentiment of a user's interactions in a discord.
    Given the following conversation, provide an organized analysis of the user's actions with direct quotes.
    **Your analysis should be no more than 1800 characters.**

    Conversation:
    {conversation}

    Provide your analysis below:
  `).format({
            conversation: conversation,
            agent_scratchpad: "",
        });
    return callModel(formattedPrompt);
}
