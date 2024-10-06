// src/commands/synapse.ts

import { SlashCommandBuilder } from '@discordjs/builders';
import { ChatInputCommandInteraction, GuildMember, Message } from 'discord.js';
import type { Conversation } from '../types';
import { collectUserConversations } from '../utils/conversation-utils';
import { analyzeSentimentWithAgent } from '../utils/agent-utils';
import { saveResultToFile, sendResultToDiscord } from '../utils/output';
import Logger from '@ptkdev/logger';
import { collectUserList } from '../utils/guild-utils';

export const data = new SlashCommandBuilder()
    .setName('synapse')
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
        const logger = new Logger();

        // Step 1: Collect User List (if needed elsewhere)
        const userList: GuildMember[] = await collectUserList(guild);

        // Step 2: Collect User Conversations
        logger.info('Collecting User Conversations...');
        // const userConversations: Conversation[] = await collectUserConversations(guild, user, days);
        // logger.info(`Collected ${userConversations.length} user conversations.`);

        // Step 3: Collect User Mentions (Uncomment if needed)
        // logger.info('Collecting User Mentions...');
        // const userMentionsConversations: Conversation[] = await collectUserMentions(
        //     guild,
        //     { userId: user.id, username: user.username },
        //     days
        // );
        // logger.info(`Collected ${userMentionsConversations.length} mention conversations.`);

        // Step 4: Aggregate Data
        // Uncomment the following lines if using mentions
        // console.log('Aggregating Data...');
        // const aggregatedData: Message<boolean>[] = [
        //     ...userConversations.flatMap(conv => conv.messages),
        //     ...userMentionsConversations.flatMap(conv => conv.messages),
        // ];

        // Since userMentionsConversations is commented out, only use userConversations
        console.log('Aggregating Data...');
        // const aggregatedData: Message<boolean>[] = userConversations.flatMap(conv => conv.messages);
        // logger.info(`Total aggregated messages: ${aggregatedData.length}`);

        // Step 5: Format Conversations
        console.log('Formatting Conversations...');
        // const formattedConversationsText = aggregatedData.map(msg => (
        //     `[${msg.author.username}] ${msg.content}`
        // )).join('\n');

        // Step 6: Analyze Sentiment Using the Agent
        console.log('Analyzing Sentiment...');
        // const analysisResult = await analyzeSentimentWithAgent(formattedConversationsText);

        // Step 7: Handle Results (Send to Discord and Save as TXT)
        console.log('Handling Analysis Results...');
        // await handleTestResult(interaction, user.username, analysisResult);
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
