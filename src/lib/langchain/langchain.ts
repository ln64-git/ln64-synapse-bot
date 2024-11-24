import { callModel } from "./model.ts";
import { ChatPromptTemplate } from "@langchain/core/prompts";

export async function generateSentimentAnalysis(
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

export async function generateCypherQuery(question: string): Promise<string> {
    const formattedPrompt = await ChatPromptTemplate.fromTemplate(`
      You are an AI assistant that translates English questions into Cypher queries for a Neo4j database. 
      The database contains nodes labeled User, Message, Conversation, Channel, Guild, and Role, 
      with relationships such as HAS_MEMBER, HAS_MESSAGE, IN_CHANNEL, MENTIONS, and NEXT_MESSAGE.
      When generating a query, ensure the correct property for a user's name is queried (e.g., COALESCE(u.displayName, u.username)).
      Translate the following question into a Cypher query. Only provide the Cypher query and nothing else.
      Question: "${question}"
      Cypher Query:
      `).format({ question });

    const response = await callModel(formattedPrompt);
    const cypherQuery = response.trim();

    if (!cypherQuery) {
        throw new Error("Failed to generate Cypher query.");
    }

    return cypherQuery;
}

export async function generateNaturalLanguageResponse(
    records: Record<string, unknown>[],
): Promise<string> {
    const formattedPrompt = await ChatPromptTemplate.fromTemplate(`
    You are an AI assistant that translates Cypher query results into natural language responses.
    Given the following Cypher query results, provide a natural language summary.
    Cypher Query Results:
    {records}

    Provide your summary below:
  `).format({
            records: JSON.stringify(records, null, 2),
        });
    return callModel(formattedPrompt);
}
