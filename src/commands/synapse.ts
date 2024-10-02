import { SlashCommandBuilder } from "@discordjs/builders";
import {
    ChatInputCommandInteraction,
    TextChannel,
    ChannelType,
    type Snowflake,
} from "discord.js";
import { analyzeSentimentWithOllama } from "../utils/ollama";

export const data = new SlashCommandBuilder()
    .setName("synapse")
    .setDescription("Analyzes a user's messages for sentiment and provides insights.")
    .addUserOption((option) =>
        option.setName("user").setDescription("The user to analyze").setRequired(true)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply(); // Defer reply as this operation may take time

    const user = interaction.options.getUser("user", true);
    const guild = interaction.guild;

    if (!guild) {
        await interaction.editReply("This command can only be used in a server.");
        return;
    }

    // Prevent analyzing bot users
    if (user.bot) {
        await interaction.editReply("Cannot analyze messages from bots.");
        return;
    }

    console.log(`Analyzing messages for user: ${user.tag} (${user.id})`);

    // Define a type for message data
    interface MessageData {
        content: string;
        createdAt: Date;
    }

    const messages: MessageData[] = [];

    // Limit the maximum number of messages to collect to prevent overloading
    const MAX_MESSAGES = 100;
    let collectedMessageCount = 0;

    // Iterate over text channels in the guild
    const channels = guild.channels.cache.filter(
        (channel) => channel.type === ChannelType.GuildText
    );

    for (const channel of channels.values()) {
        if (collectedMessageCount >= MAX_MESSAGES) {
            break;
        }

        const textChannel = channel as TextChannel;

        try {
            let lastMessageId: Snowflake | undefined;
            let fetchComplete = false;

            while (!fetchComplete && collectedMessageCount < MAX_MESSAGES) {
                // Fetch messages in batches of 100
                const options = { limit: 100 } as { limit: number; before?: Snowflake };
                if (lastMessageId) {
                    options.before = lastMessageId;
                }

                const fetchedMessages = await textChannel.messages.fetch(options);

                if (fetchedMessages.size === 0) {
                    break;
                }

                // Filter messages by the specified user
                const userMessages = fetchedMessages.filter(
                    (msg) => msg.author.id === user.id
                );

                for (const msg of userMessages.values()) {
                    messages.push({
                        content: msg.content,
                        createdAt: msg.createdAt,
                    });
                    collectedMessageCount++;
                    if (collectedMessageCount >= MAX_MESSAGES) {
                        fetchComplete = true;
                        break;
                    }
                }

                lastMessageId = fetchedMessages.last()?.id;
                if (fetchedMessages.size < 100) {
                    break;
                }
            }
        } catch (error) {
            console.error(`Error fetching messages from channel ${textChannel.name}:`, error);
        }
    }

    if (messages.length === 0) {
        await interaction.editReply("No messages found for the specified user.");
        return;
    }

    // Sort messages by sent time (from oldest to newest)
    messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Analyze the messages using Ollama
    try {
        const analysis = await analyzeSentiment(messages);
        await interaction.editReply(`Sentiment analysis for ${user.username}:\n${analysis}`);
    } catch (error) {
        console.error("Error analyzing sentiment:", error);
        await interaction.editReply("There was an error analyzing the sentiment.");
    }
}

interface MessageData {
    content: string;
    createdAt: Date;
}

// Function to analyze sentiment
async function analyzeSentiment(messages: MessageData[]): Promise<string> {
    // Combine the messages into a single text, maintaining order
    const combinedText = messages.map((msg) => msg.content).join("\n");

    console.log("Combined Text:", combinedText);

    // Use the actual Ollama function
    return await analyzeSentimentWithOllama(combinedText);

    // For testing purposes, use the fake analysis
    return fakeOllamaAnalyze(combinedText);
}

// Temporary fake function to simulate sentiment analysis
function fakeOllamaAnalyze(text: string): string {
    // This is just a placeholder. Replace it with actual analysis.
    return "The user's messages exhibit a generally positive sentiment with occasional neutral tones.";
}
