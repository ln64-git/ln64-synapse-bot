import { SlashCommandBuilder } from "@discordjs/builders";
import {
    ChatInputCommandInteraction,
    TextChannel,
    ChannelType,
    Message,
    Collection,
    type Snowflake,
} from "discord.js";

// Placeholder import for Ollama's sentiment analysis function
// Replace this with the actual import from Ollama's SDK or API client
// import { analyzeSentimentWithOllama } from 'ollama-sdk';

export const data = new SlashCommandBuilder()
    .setName("synapse")
    .setDescription("Analyzes a user's messages for sentiment and provides insights.")
    .addUserOption((option) =>
        option.setName("user").setDescription("The user to analyze").setRequired(true)
    )
    .addStringOption((option) =>
        option
            .setName("since")
            .setDescription("Optional date since when to collect messages (e.g., MM/DD/YYYY)")
    )
    .addIntegerOption((option) =>
        option.setName("days").setDescription("Optional number of days back to collect messages")
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply(); // Defer reply as this operation may take time

    const user = interaction.options.getUser("user", true);
    const sinceInput = interaction.options.getString("since");
    const daysInput = interaction.options.getInteger("days");

    let sinceDate: Date | null = null;

    if (sinceInput) {
        // Parse the date input
        sinceDate = new Date(sinceInput);
        if (isNaN(sinceDate.getTime())) {
            await interaction.editReply("Invalid date format. Please use MM/DD/YYYY.");
            return;
        }
    } else if (daysInput) {
        // Calculate the date based on days input
        sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - daysInput);
    }

    const messages: string[] = [];
    const guild = interaction.guild;

    if (!guild) {
        await interaction.editReply("This command can only be used in a server.");
        return;
    }

    // Limit the maximum number of messages to collect to prevent overloading
    const MAX_MESSAGES = 1000;
    let collectedMessageCount = 0;

    // Iterate over text channels in the guild
    const channels = guild.channels.cache.filter(
        (channel) =>
            channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement
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
                // Define options inline without specifying a type
                const options = { limit: 100 } as { limit: number; before?: Snowflake };
                if (lastMessageId) {
                    options.before = lastMessageId;
                }

                const fetchedMessages = await textChannel.messages.fetch(options);

                if (fetchedMessages.size === 0) {
                    break;
                }

                for (const msg of fetchedMessages.values()) {
                    // Check if the message is from the specified user and within the time frame
                    if (msg.author.id === user.id) {
                        if (sinceDate && msg.createdAt < sinceDate) {
                            fetchComplete = true;
                            break;
                        }
                        messages.push(msg.content);
                        collectedMessageCount++;
                        if (collectedMessageCount >= MAX_MESSAGES) {
                            fetchComplete = true;
                            break;
                        }
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
        await interaction.editReply(
            "No messages found for the specified user in the given time frame."
        );
        return;
    }

    // Analyze the messages using Ollama
    try {
        const analysis = await analyzeSentiment(messages);
        await interaction.editReply(`Sentiment analysis for ${user.username}:\n${analysis}`);
    } catch (error) {
        console.error("Error analyzing sentiment:", error);
        await interaction.editReply("There was an error analyzing the sentiment.");
    }
}

// Placeholder function for sentiment analysis
async function analyzeSentiment(messages: string[]): Promise<string> {
    const combinedText = messages.join("\n");

    // Replace the following line with actual API calls to Ollama
    // For example: return await analyzeSentimentWithOllama(combinedText);
    return fakeOllamaAnalyze(combinedText); // Remove this line when using the actual API
}

// Temporary fake function to simulate sentiment analysis
function fakeOllamaAnalyze(text: string): string {
    // This is just a placeholder. Replace it with actual analysis.
    return "The user's messages exhibit a generally positive sentiment with occasional neutral tones.";
}
