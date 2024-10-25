import { Message } from "discord.js";
import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { fetchMessagesFromGuildChannel } from "../discord/guild-utils";
import { PineconeVector } from "../types";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
});
const pc = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY!,
});

export const data = new SlashCommandBuilder()
    .setName("test")
    .setDescription("A simple test command")
    .addIntegerOption((option) =>
        option
            .setName("count")
            .setDescription("Count of messages back in history")
            .setRequired(true)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    // Fetch the guild and channel
    const guild = interaction.guild;
    const twiscoElysium = guild?.channels.cache.get("1294628072418447473");
    // const firesideChat = guild?.channels.cache.get("1004111008337502270");
    if (!twiscoElysium || !twiscoElysium.isTextBased()) {
        return await interaction.reply("Channel not found or invalid");
    }

    // 1. Scrape data from the Discord guild using discord.js.
    const count = interaction.options.getInteger("count") || 0;
    const messages = await fetchMessagesFromGuildChannel(twiscoElysium, count);
    messages.forEach((message) => {
        console.log(
            `[${message.createdAt.toISOString()}] ${message.author.username}: ${message.content}`,
        );
    });

    // 3. Convert the content into vector embeddings using Pinecone.
    const embeddings = await generateEmbeddings(messages);

    // 4. Store the vectors in a vector database like Pinecone.

    // await interaction.reply("Test command executed successfully!");
}

async function generateEmbeddings(
    messages: Message[],
): Promise<PineconeVector[]> {
    const embeddings: PineconeVector[] = [];
    const batchSize = 20; // Adjust batch size based on your needs and rate limits
    const embeddingModel = "text-embedding-ada-002"; // OpenAI's embedding model

    for (let i = 0; i < messages.length; i += batchSize) {
        const batch = messages.slice(i, i + batchSize);
        const inputs = batch.map((msg) => msg.content).filter((text) =>
            text.length > 0
        );

        if (inputs.length === 0) continue;

        try {
            const response = await openai.embeddings.create({
                model: embeddingModel,
                input: inputs,
            });

            const data = response.data;

            for (let j = 0; j < data.length; j++) {
                const msg = batch[j];
                const embedding = data[j].embedding;

                embeddings.push({
                    id: msg.id,
                    values: embedding,
                    metadata: {
                        author: msg.author,
                        timestamp: msg.createdTimestamp,
                        channelId: msg.channelId,
                        attachments: msg.attachments,
                    },
                });
            }
        } catch (error) {
            console.error(
                `Failed to generate embeddings for batch starting at index ${i}:`,
                error,
            );
        }
    }

    return embeddings;
}
