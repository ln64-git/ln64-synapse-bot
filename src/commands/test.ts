import { SlashCommandBuilder } from '@discordjs/builders';
import { ChatInputCommandInteraction, Message } from 'discord.js';
import { saveResultToFile, sendResultToDiscord } from '../utils/output';
import { Conversation } from '../types';
import { collectUserConversations } from '../utils/conversation-utils';

export const data = new SlashCommandBuilder()
    .setName('test')
    .setDescription("Analyzes a user's messages for sentiment and provides insights.")
    .addUserOption((option) =>
        option.setName('user').setDescription('The user to analyze').setRequired(true)
    )
    .addIntegerOption((option) =>
        option
            .setName('days')
            .setDescription('Number of days to look back from today')
            .setRequired(false)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    const validationResponse = await validateInteraction(interaction);
    if (typeof validationResponse === 'string') {
        return await interaction.editReply(validationResponse);
    }
    const { guild, user, days } = validationResponse;
    console.log(`Analyzing messages for user: ${user.tag} (${user.id})`);

    try {
        // Step 1: Collect User Conversations
        const userConversations: Conversation[] = await collectUserConversations(guild, user, days);

        // Step 2: Clean up and format the output
        const formattedConversations = userConversations.map(conv => ({
            startTime: conv.startTime,
            endTime: conv.endTime,
            messages: conv.messages.map(msg => ({
                author: msg.author.username,
                content: msg.content,
                timestamp: msg.createdAt.toISOString(),
                channelId: msg.channelId,
            })),
        }));

        // Step 3: Convert the output to a readable JSON string
        const outputData = JSON.stringify(formattedConversations, null, 2); // Pretty-print JSON with 2-space indentation
        console.log(outputData)
        // Step 4: Send or save the result based on its size
        await handleTestResult(interaction, user.username, outputData);
    } catch (error) {
        console.error('Error during analysis:', error);
        await interaction.editReply('There was an error analyzing the sentiment.');
    }
}

async function validateInteraction(
    interaction: ChatInputCommandInteraction
): Promise<{ guild: any, user: any, days: number | undefined } | string> {
    const guild = interaction.guild;
    if (!guild) {
        return 'This command can only be used in a server.';
    }
    const user = interaction.options.getUser('user', true);
    if (user.bot) {
        return 'Cannot analyze messages from bots.';
    }
    const days = interaction.options.getInteger('days') ?? undefined;

    return { guild, user, days };
}

export async function handleTestResult(
    interaction: ChatInputCommandInteraction,
    username: string,
    outputData: string
): Promise<void> {
    try {
        // Discord messages have a 2000 character limit, check the size
        if (outputData.length <= 2000) {
            await sendResultToDiscord(interaction, username, outputData);
        } else {
            await saveResultToFile(interaction, username, outputData);
            await interaction.editReply(
                `Sentiment analysis for ${username} exceeds Discord's character limit. The analysis has been saved to a file.`
            );
        }
    } catch (error) {
        console.error('Error handling report data:', error);
        await interaction.editReply('There was an error handling the analysis result.');
    }
}
