// src/commands/synapse.ts

import { SlashCommandBuilder } from "@discordjs/builders";
import {
    ChatInputCommandInteraction,
    Guild,
    GuildMember,
    Message,
} from "discord.js";
import { assembleConversations } from "../utils/conversation-utils";
import { saveResultToFile, sendResultToDiscord } from "../utils/output";
import Logger from "@ptkdev/logger";
import {
    fetchMentionsFromGuild,
    fetchMessagesFromGuild,
} from "../discord/guild-utils";
import { analyzeConversationWithAgent } from "../langchain/agents";

export const data = new SlashCommandBuilder()
    .setName("synapse")
    .setDescription(
        "Analyzes a user's messages for sentiment and provides insights.",
    )
    .addUserOption((option) =>
        option.setName("user").setDescription("The user to analyze")
            .setRequired(true)
    )
    .addIntegerOption((option) =>
        option
            .setName("days")
            .setDescription("Number of days to look back from today")
            .setRequired(false)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    const validationResponse = await validateInteraction(interaction);
    if (typeof validationResponse === "string") {
        return await interaction.editReply(validationResponse);
    }
    const { guild, user, days } = validationResponse;
    console.log(
        `Analyzing messages for user: ${user.displayName} (${user.id})`,
    );

    try {
        const logger = new Logger();

        // Collect user conversations and mentions (arrays of messages)
        const userConversations: Message[] = await fetchMessagesFromGuild(
            guild,
            user,
            days,
        );
        logger.info(`Collected ${userConversations.length} user messages.`);

        logger.info("Collecting User Mentions...");
        const userMentions: Message[] = await fetchMentionsFromGuild(
            guild,
            user,
            days,
        );
        logger.info(
            `Collected ${userMentions.length} messages mentioning the user.`,
        );

        console.log("Aggregating Data...");

        // Format the aggregated messages into a string for sentiment analysis
        const aggregatedMessages = [
            ...userConversations, // These are individual messages
            ...userMentions, // These are individual messages
        ]
            .map((msg) =>
                `${msg.author.username}: ${msg.content} [${msg.createdAt.toISOString()}]`
            )
            .sort((a, b) =>
                new Date(a.split("[")[1]).getTime() -
                new Date(b.split("[")[1]).getTime()
            ) // Sort by timestamp
            .join("\n"); // Join the messages into a single string

        // Step 6: Analyze Sentiment Using the Agent
        console.log("Analyzing Sentiment...");
        const analysisResult = await analyzeConversationWithAgent(
            aggregatedMessages,
        ); // Pass the formatted conversation

        // Step 7: Handle Results (Send to Discord and Save as TXT)
        console.log("Handling Analysis Results...");
        await handleTestResult(interaction, user, analysisResult);
    } catch (error) {
        console.error("Error during analysis:", error);
        await interaction.editReply(
            "There was an error analyzing the sentiment.",
        );
    }
}

async function validateInteraction(
    interaction: ChatInputCommandInteraction,
): Promise<
    { guild: Guild; user: GuildMember; days: number | undefined } | string
> {
    const guild = interaction.guild;
    if (!guild) {
        return "This command can only be used in a server.";
    }

    // Use `getMember` to retrieve the GuildMember object instead of a User object
    const user = interaction.options.getMember("user") as GuildMember;

    // Check if the user is a bot or if we couldn't find the user
    if (!user) {
        return "Could not find the user. Make sure the user is part of the server.";
    }
    if (user.user.bot) {
        return "Cannot analyze messages from bots.";
    }

    const days = interaction.options.getInteger("days") ?? undefined;
    return { guild, user, days };
}

export async function handleTestResult(
    interaction: ChatInputCommandInteraction,
    user: GuildMember,
    outputData: string,
): Promise<void> {
    try {
        // Discord messages have a 2000 character limit, check the size
        if (outputData.length <= 2000) {
            await sendResultToDiscord(interaction, user, outputData);
        } else {
            await saveResultToFile(interaction, user, outputData);
            await interaction.editReply(
                `Sentiment analysis for ${user} exceeds Discord's character limit. The analysis has been saved to a file.`,
            );
        }
    } catch (error) {
        console.error("Error handling report data:", error);
        await interaction.editReply(
            "There was an error handling the analysis result.",
        );
    }
}
