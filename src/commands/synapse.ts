import { SlashCommandBuilder } from '@discordjs/builders';
import { AttachmentBuilder, ChatInputCommandInteraction } from 'discord.js';
import type { Conversation } from '../types';
import { collectUserConversations } from '../utils/collect-user-conversation';
import { analyzeSentimentWithOllama } from '../utils/ollama';

// src/commands/synapse.ts

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
    
        // Retrieve the 'days' parameter and convert null to undefined
        const days = interaction.options.getInteger('days') ?? undefined;
    
        console.log(`Analyzing messages for user: ${user.tag} (${user.id})`);
    
        try {
            console.log('Collecting User Conversations...');
            // 1. Collect user conversations, pass 'days' parameter
            const userConversations: Conversation[] = await collectUserConversations(guild, user, days);
            if (userConversations.length === 0) {
                await interaction.editReply('No conversations found involving the specified user.');
                return;
            }
            console.log('User Conversations Collected.');
    
            console.log("Analyzing Conversations...")
            // 2. Analyze conversations
            const analysisResults: string[] = [];
            for (const conv of userConversations) {
    
                const convText = conv.messages
                    .map((msg) => `${msg.authorUsername}: ${msg.content}`)
                    .join('\n');
    
                const analysisResult = await analyzeSentimentWithOllama(convText);
    
                analysisResults.push(
                    `**${conv.summaryTitle}**\nTime: ${conv.startTime.toISOString()} - ${conv.endTime.toISOString()}\n${analysisResult}`
                );
            }  // Close for loop
            console.log("Analysis Complete.")
    
            // 3. Send analysis result
            await sendAnalysisResult(interaction, user.username, analysisResults);
    
        } catch (error) {
            console.error('Error during analysis:', error);
            await interaction.editReply('There was an error analyzing the sentiment.');
        }
    }
    
export async function sendAnalysisResult(
    interaction: ChatInputCommandInteraction,
    username: string,
    analysisResults: string[]
): Promise<void> {
    const totalAnalysis = analysisResults.join('\n\n');
    if (totalAnalysis.length <= 2000) {
        await interaction.editReply(
            `Sentiment analysis for ${username}:\n${totalAnalysis}`
        );
    } else {
        // Send as a file if too long
        const attachment = new AttachmentBuilder(Buffer.from(totalAnalysis, 'utf-8'), {
            name: 'analysis.txt',
        });
        await interaction.editReply({
            content: `Sentiment analysis for ${username}:`,
            files: [attachment],
        });
    }
}
