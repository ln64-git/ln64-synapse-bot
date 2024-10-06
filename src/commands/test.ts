import { SlashCommandBuilder } from '@discordjs/builders';
import { ChatInputCommandInteraction, GuildMember, Message } from 'discord.js';
import { saveResultToFile, sendResultToDiscord } from '../utils/output';
import { collectUserConversations, collectUserMentions } from '../utils/conversation-utils';
import Logger from '@ptkdev/logger';

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
    console.log(`Analyzing messages for user: ${user.displayName} (${user.id})`);

    try {
        const logger = new Logger();

        // Collect user conversations and mentions (arrays of messages)
        const userConversations: Message[] = await collectUserConversations(guild, user, days);
        logger.info(`Collected ${userConversations.length} user messages.`);

        logger.info('Collecting User Mentions...');
        const userMentions: Message[] = await collectUserMentions(guild, user, days);
        logger.info(`Collected ${userMentions.length} messages mentioning the user.`);

        const aggregatedMessages = [
            ...userConversations,   // These are individual messages
            ...userMentions         // These are individual messages
        ]
            .map(msg => ({
                author: msg.author.username,
                content: msg.content,
                timestamp: msg.createdAt
            }))
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()); // Sort by timestamp

        // Convert the sorted messages to JSON format
        const jsonOutput = JSON.stringify(aggregatedMessages, null, 2); // Pretty print JSON with indentation

        // Send or save the JSON output
        await handleTestResult(interaction, user.displayName, jsonOutput);

    } catch (error) {
        console.error('Error during analysis:', error);
        await interaction.editReply('There was an error analyzing the sentiment.');
    }
}

async function validateInteraction(
    interaction: ChatInputCommandInteraction
): Promise<{ guild: any, user: GuildMember, days: number | undefined } | string> {
    const guild = interaction.guild;
    if (!guild) {
        return 'This command can only be used in a server.';
    }

    // Use `getMember` instead of `getUser` to retrieve the GuildMember object.
    const user = interaction.options.getMember('user') as GuildMember;
    if (!user || user.user.bot) {
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
