// src/commands/synapse.ts

import { SlashCommandBuilder } from '@discordjs/builders';
import { ChatInputCommandInteraction } from 'discord.js';
import type { UserData } from '../types';
import { collectUserList } from '../utils/guild-utils';
import { saveResultToFile, sendResultToDiscord } from '../utils/output';

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
        console.log('Collecting User List...');
        const userList: UserData[] = await collectUserList(guild);
        console.log(`Collected ${userList.length} users.`);

        const outputData = ""
        await handleTestResult(interaction, user.username, outputData)
    } catch (error) {
        console.error('Error during analysis:', error);
        await interaction.editReply('There was an error analyzing the sentiment.');
    }
}


export async function handleTestResult(
    interaction: ChatInputCommandInteraction,
    username: string,
    outputData: string
): Promise<void> {
    try {
        if (outputData.length <= 2000) {
            await sendResultToDiscord(interaction, username, outputData);
        } else {
            await saveResultToFile(interaction, username, outputData);
        }
    } catch (error) {
        console.error('Error handling report data:', error);
        await interaction.editReply('There was an error handling the analysis result.');
    }
}