import { callModel } from "./model.ts";
import { ChatPromptTemplate } from "npm:@langchain/core/prompts";

export async function gernerateSentimentAnalysis(
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
    const nodes = ["User", "Message", "Channel", "Guild"];
    const relationships = [
        "SENT_MESSAGE",
        "IN_CHANNEL",
        "MENTIONS",
        "HAS_MEMBER",
        "HAS_ROLE",
        "ASSIGNED_TO",
        "HAS_CHANNEL",
        "PARENT_OF",
        "NEXT_MESSAGE",
        "REPLIES_TO",
    ];
    const formattedPrompt = await ChatPromptTemplate.fromTemplate(`
    You are an AI assistant that translates English questions into Cypher queries for a Neo4j database. The database contains nodes labeled ${
        nodes.join(", ")
    }, with relationships such as ${relationships.join(", ")}.
    Translate the following question into a Cypher query. Only provide the Cypher query and nothing else.
    Question: "${question}"
    Cypher Query:
  `).format({
            question: question,
        });
    const response = await callModel(formattedPrompt);
    let cypherQuery = response.trim();
    if (!cypherQuery) {
        throw new Error("Failed to generate Cypher query.");
    }
    // Replace curly braces with parentheses
    cypherQuery = cypherQuery.replace(
        /\{days: (\d+)\}/g,
        "duration({days: $1})",
    );
    // Replace size() with COUNT {}
    cypherQuery = cypherQuery.replace(/size\(\(([^)]+)\)\)/g, "COUNT($1)");
    return cypherQuery;
}
