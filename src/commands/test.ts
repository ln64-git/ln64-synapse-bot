import { SlashCommandBuilder } from "@discordjs/builders";
import { ChatInputCommandInteraction, GuildMember } from "discord.js";
import { saveResultToFile, sendResultToDiscord } from "../utils/output";
import { analyzeConversationWithAgent } from "../langchain/agents";
import Logger from "@ptkdev/logger";
import { validateInteraction } from "../discord/guild-utils";
import { assembleBackground } from "../function/assemble-background";

// Initialize the logger
const logger = new Logger();

export const data = new SlashCommandBuilder()
    .setName("test")
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
    logger.info(
        `Analyzing messages for user: ${user.displayName} (${user.id})`,
    );

    try {
        const startTime = Date.now();

        // Aggregate conversations
        const conversations = await assembleBackground(guild, user, days);

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
        logger.info("Analyzing Sentiment...");
        const analysisResult = await analyzeConversationWithAgent(
            aggregatedMessages,
        );

        const endTime = Date.now();
        logger.info(
            `Sentiment analysis completed in ${endTime - startTime} ms`,
        );

        // Step 7: Handle Results (Send to Discord and Save as TXT)
        logger.info("Handling Analysis Results...");
        await handleTestResult(interaction, user, analysisResult);
    } catch (error) {
        logger.error("Error during analysis:", String(error));
        await interaction.editReply(
            "There was an error analyzing the sentiment.",
        );
    }
}

export async function handleTestResult(
    interaction: ChatInputCommandInteraction,
    user: GuildMember,
    outputData: string,
): Promise<void> {
    try {
        // Discord messages have a 2000 character limit, check the size
        // if (outputData.length <= 2000) {
        //     await sendResultToDiscord(interaction, user, outputData);
        // } else {
        // }
        await saveResultToFile(interaction, user, outputData);
        await interaction.editReply(
            `Sentiment analysis for ${user} exceeds Discord's character limit. The analysis has been saved to a file.`,
        );
    } catch (error) {
        logger.error("Error handling report data:", String(error));
        await interaction.editReply(
            "There was an error handling the analysis result.",
        );
    }
}
