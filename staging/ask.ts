// src/commands/ask.ts

import dotenv from "npm:dotenv";
import neo4j from "npm:neo4j-driver";
import { ChatInputCommandInteraction } from "npm:discord.js";
import { SlashCommandBuilder } from "npm:@discordjs/builders";

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

    // Validate the Cypher query to prevent destructive operations
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

    try {
        // Initialize OpenAI
        const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
        if (!openaiApiKey) {
            throw new Error("Missing OPENAI_API_KEY environment variable.");
        }

        const configuration = new Configuration({
            apiKey: openaiApiKey,
        });
        const openai = new OpenAIApi(configuration);

        // Generate Cypher Query using OpenAI
        const prompt = `
You are an AI assistant that translates English questions into Cypher queries for a Neo4j database. The database contains nodes labeled User, Message, Channel, and Guild, with relationships such as SENT_MESSAGE, IN_CHANNEL, MENTIONS, HAS_MEMBER, etc.

Translate the following question into a Cypher query. Only provide the Cypher query and nothing else.

Question: "${question}"

Cypher Query:
`;

        const response = await openai.createCompletion({
            model: "text-davinci-003",
            prompt,
            max_tokens: 100,
        });

        const cypherQuery = response.data.choices[0].text?.trim();
        if (!cypherQuery) {
            throw new Error("Failed to generate Cypher query.");
        }

        if (!isValidCypherQuery(cypherQuery)) {
            throw new Error(
                "Generated Cypher query contains forbidden operations.",
            );
        }

        // Execute Cypher Query
        const neo4jUri = Deno.env.get("NEO4J_URI");
        const neo4jUser = Deno.env.get("NEO4J_USERNAME");
        const neo4jPassword = Deno.env.get("NEO4J_PASSWORD");

        if (!neo4jUri || !neo4jUser || !neo4jPassword) {
            throw new Error("Missing Neo4j environment variables.");
        }

        const driver = neo4j.driver(
            neo4jUri,
            neo4j.auth.basic(neo4jUser, neo4jPassword),
        );

        const session = driver.session();

        try {
            const result = await session.run(cypherQuery);

            // Process Results
            const records = result.records.map((
                record: { toObject: () => Record<string, unknown> },
            ) => record.toObject());

            if (records.length === 0) {
                await interaction.editReply("No results found.");
            } else {
                // Convert records to a readable format
                const formattedResults = records.map((
                    record: Record<string, unknown>,
                ) => JSON.stringify(record, null, 2)).join("\n");

                // Discord messages have a character limit
                const MAX_MESSAGE_LENGTH = 2000;
                let replyContent = `\`\`\`json\n${formattedResults}\n\`\`\``;

                if (replyContent.length > MAX_MESSAGE_LENGTH) {
                    replyContent =
                        replyContent.substring(0, MAX_MESSAGE_LENGTH - 10) +
                        "\n...```";
                }

                await interaction.editReply(replyContent);
            }
        } finally {
            await session.close();
            await driver.close();
        }
    } catch (error) {
        console.error("Error:", error);
        await interaction.editReply(
            "An error occurred while processing your query.",
        );
    }
}
