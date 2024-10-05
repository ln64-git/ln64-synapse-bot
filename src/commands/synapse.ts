// src/commands/synapse.ts

import { SlashCommandBuilder } from '@discordjs/builders';
import { AttachmentBuilder, ChatInputCommandInteraction } from 'discord.js';
import type { Conversation, UserData, MessageData } from '../types';
import { collectUserConversations, collectUserMentions } from '../utils/conversation-utils';
import { collectUserList } from '../utils/guild-utils';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeSentimentWithAgent } from '../utils/agent-utils';

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

/**
 * Executes the /synapse command.
 * @param interaction The command interaction.
 */
export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply(); // Defer reply as this operation may take time
    const guild = interaction.guild;
    if (!guild) {
        await interaction.editReply('This command can only be used in a server.');
        return;
    }
    const user = interaction.options.getUser('user', true);
    if (user.bot) {
        await interaction.editReply('Cannot analyze messages from bots.');
        return;
    }

    const days = interaction.options.getInteger('days') ?? undefined;

    console.log(`Analyzing messages for user: ${user.tag} (${user.id})`);

    try {
        // Step 1: Collect Relevant Data

        // 1.1. Collect User List
        console.log('Collecting User List...');
        const userList: UserData[] = await collectUserList(guild);
        console.log(`Collected ${userList.length} users.`);

        // 1.2. Collect User Conversations
        console.log('Collecting User Conversations...');
        const userConversations: Conversation[] = await collectUserConversations(guild, user, days);
        if (userConversations.length === 0) {
            await interaction.editReply('No conversations found involving the specified user.');
            return;
        }
        console.log('User Conversations Collected.');

        // 1.3. Collect User Mentions
        console.log('Collecting User Mentions...');
        const userMentions: MessageData[] = await collectUserMentions(
            guild,
            { userId: user.id, username: user.username, },
            days
        );
        console.log(`Collected ${userMentions.length} mentions.`);

        // Step 2: Aggregate Data Appropriately

        console.log('Aggregating Data...');
        // Combine conversations and mentions
        const aggregatedData: MessageData[] = [
            ...userConversations.flatMap(conv => conv.messages),
            ...userMentions,
        ];

        console.log(`Total aggregated messages: ${aggregatedData.length}`);

        // Step 3: Format Conversations to Readable Text

        console.log('Formatting Conversations...');
        const formattedConversationsText = aggregatedData.map(msg => (
            `[${msg.authorUsername}] ${msg.content}`
        )).join('\n');

        // Step 4: Analyze Sentiment Using the Agent

        console.log('Analyzing Sentiment...');
        const analysisResult = await analyzeSentimentWithAgent(formattedConversationsText);

        // Step 5: Handle the Result

        console.log('Handling Analysis Result...');
        await handleAnalysisResult(interaction, user.username, analysisResult);
    } catch (error) {
        console.error('Error during analysis:', error);
        await interaction.editReply('There was an error analyzing the sentiment.');
    }
}

async function handleAnalysisResult(
    interaction: ChatInputCommandInteraction,
    username: string,
    analysisResult: string
): Promise<void> {
    try {
        // Send the analysis result to Discord
        if (analysisResult.length <= 2000) {
            await interaction.editReply(
                `**Sentiment analysis for ${username}:**\n${analysisResult}`
            );
        } else {
            // Save the analysis as a text file
            const outputDir = path.resolve(__dirname, '../../output');
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            const filePath = path.join(outputDir, `${username}_analysis.txt`);
            fs.writeFileSync(filePath, analysisResult, 'utf-8');
            console.log(`Analysis saved to ${filePath}`);

            // Send the file to Discord
            const attachment = new AttachmentBuilder(filePath, {
                name: `${username}_analysis.txt`,
            });

            await interaction.editReply({
                content: `Sentiment analysis for ${username} exceeds Discord's character limit. Please find the analysis attached.`,
                files: [attachment],
            });
        }
    } catch (error) {
        console.error('Error handling analysis result:', error);
        await interaction.editReply('There was an error sending the analysis result.');
    }
}
