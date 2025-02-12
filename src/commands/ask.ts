// src/commands/ask.ts

import dotenv from "dotenv";
import { ChatInputCommandInteraction } from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import {
    generateCypherQuery,
    generateNaturalLanguageResponse,
} from "../lib/openai/prompts.ts"; // Update the import path
import { executeCypherQuery } from "../lib/neo4j/neo4j.ts";

dotenv.config();

export const data = new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask a question about the Discord data.")
    .addStringOption((option) =>
        option
            .setName("question")
            .setDescription("Your natural language question")
            .setRequired(true)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    const question = interaction.options.getString("question", true);
    await interaction.deferReply();

    try {
        // Generate Cypher Query using LangChain
        const cypherQuery = await generateCypherQuery(question);
        if (!isValidCypherQuery(cypherQuery)) {
            throw new Error(
                "Generated Cypher query contains forbidden operations.",
            );
        }
        // Execute Cypher Query
        const records = await executeCypherQuery(cypherQuery);
        console.log(records);
        const response = await generateNaturalLanguageResponse(records);
        // Utilize langchain to translate the response into natural language
        await handleQueryResult(interaction, records);
        await interaction.editReply(response);
    } catch (error) {
        console.error("Error:", error);
        await interaction.editReply(
            "An error occurred while processing your query.",
        );
    }
}

function isValidCypherQuery(query: string): boolean {
    const forbiddenKeywords = [
        "CREATE",
        "MERGE",
        "DELETE",
        "SET",
        "DROP",
        "REMOVE",
    ];
    const pattern = new RegExp(
        `\\b(${forbiddenKeywords.join("|")})\\b`,
        "i",
    );
    return !pattern.test(query);
}

async function handleQueryResult(
    interaction: ChatInputCommandInteraction,
    records: Record<string, unknown>[],
) {
    if (records.length === 0) {
        await interaction.editReply("No results found.");
    } else {
        // Convert records to a readable format
        const formattedResults = records
            .map((record) => JSON.stringify(record, null, 2))
            .join("\n");
        // Discord messages have a character limit
        const MAX_MESSAGE_LENGTH = 2000;
        let replyContent = `\`\`\`json\n${formattedResults}\n\`\`\``;
        if (replyContent.length > MAX_MESSAGE_LENGTH) {
            replyContent = replyContent.substring(0, MAX_MESSAGE_LENGTH - 10) +
                "\n...```";
        }
        await interaction.editReply(replyContent);
    }
}

async function ask(question: string): Promise<string> {
    try {
        console.log(`Received question: "${question}"`);

        const cypherQuery = await generateCypherQuery(question);
        console.log(`Generated Cypher Query: ${cypherQuery}`);

        const records = await executeCypherQuery(cypherQuery);
        if (!records || records.length === 0) {
            console.warn(
                "Query returned no results. Ensure the database contains relevant data.",
            );
            return "No results found for your query.";
        }

        const topUser = records[0]["userName"] || "Unknown User";
        const response = `The person with the most messages is: ${topUser}.`;
        console.log(`Generated Response: ${response}`);

        return response;
    } catch (error) {
        console.error("Error in ask function:", error);
        return "An error occurred while processing your query. Please try again.";
    }
}
