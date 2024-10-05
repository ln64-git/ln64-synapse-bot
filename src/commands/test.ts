// src/commands/synapse.ts

import { SlashCommandBuilder } from '@discordjs/builders';
import { ChatInputCommandInteraction } from 'discord.js';
import { collectUserList } from '../utils/guild-utils';
import { saveResultToFile, sendResultToDiscord } from '../utils/output';
import { GuildMember } from 'discord.js';

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
        // Step 1: Collect Relevant Data
        const memberList: GuildMember[] = await collectUserList(guild);

        let outputData = `Collected ${memberList.length} members:\n`;
        memberList.forEach((member, index) => {
            outputData += `${index + 1}. / ${member.user.username} / ${member.displayName} / ${member.user.id}\n`;
        });

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
        if (outputData.length <= 2000) {
            // await sendResultToDiscord(interaction, username, outputData);
        } else { }
        await saveResultToFile(interaction, username, outputData);
    } catch (error) {
        console.error('Error handling report data:', error);
        await interaction.editReply('There was an error handling the analysis result.');
    }
}