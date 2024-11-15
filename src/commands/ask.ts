// src/commands/ask.ts

import dotenv from "npm:dotenv";
import { ChatInputCommandInteraction } from "npm:discord.js";
import { SlashCommandBuilder } from "npm:@discordjs/builders";
import {
    generateCypherQuery,
    generateNaturalLanguageResponse,
} from "../lib/langchain/langchain.ts"; // Update the import path
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
