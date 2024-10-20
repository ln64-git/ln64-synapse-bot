// src/commands/synapse.ts

import { SlashCommandBuilder } from "@discordjs/builders";
import { ChatInputCommandInteraction, Message } from "discord.js";
import { handleResult } from "../utils/output";
import Logger from "@ptkdev/logger";
import {
    fetchAllMessagesFromGuild,
    fetchMemberMentionsFromGuild,
    validateInteraction,
} from "../discord/guild-utils";
import { analyzeConversationWithAgent } from "../langchain/agents";
import { assembleConversations } from "../utils/conversation-utils";

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
        const userConversations: Message[] = await fetchAllMessagesFromGuild(
            guild,
            days
                ? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
                : undefined,
            (msg) => msg.author.id === user.id,
        );
        logger.info(`Collected ${userConversations.length} user messages.`);

        logger.info("Collecting User Mentions...");
        const userMentions: Message[] = await fetchMemberMentionsFromGuild(
            guild,
        );
        logger.info(
            `Collected ${userMentions.length} messages mentioning the user.`,
        );

        console.log("Aggregating Data...");

        // Aggregate conversations
        const allMessages = [...userConversations, ...userMentions];
        const conversations = await assembleConversations(allMessages);

        // Format the aggregated conversations into a string for sentiment analysis
        const aggregatedMessages = conversations
            .map((conversation) =>
                conversation.messages
                    .map((msg) =>
                        `${msg.author.username}: ${msg.content} [${msg.createdAt.toISOString()}]`
                    )
                    .join("\n")
            )
            .join("\n\n"); // Separate conversations with double newlines

        // Step 6: Analyze Sentiment Using the Agent
        console.log("Analyzing Sentiment...");
        const analysisResult = await analyzeConversationWithAgent(
            aggregatedMessages,
        ); // Pass the formatted conversation

        // Step 7: Handle Results (Send to Discord and Save as TXT)
        console.log("Handling Analysis Results...");
        await handleResult(interaction, user, analysisResult);
    } catch (error) {
        console.error("Error during analysis:", error);
        await interaction.editReply(
            "There was an error analyzing the sentiment.",
        );
    }
}
