import { AttachmentBuilder, ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Conversation } from "../types";
import { collectUserConversations } from "../utils/conversation-utils";
import { analyzeSentimentWithAgent } from "../utils/agent-utils";
import * as fs from 'fs';
import * as path from 'path';

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

    const days = interaction.options.getInteger('days') ?? undefined;

    console.log(`Analyzing messages for user: ${user.tag} (${user.id})`);

    try {
        console.log('Collecting User Conversations...');
        const userConversations: Conversation[] = await collectUserConversations(guild, user, days);
        if (userConversations.length === 0) {
            await interaction.editReply('No conversations found involving the specified user.');
            return;
        }

        console.log('User Conversations Collected.');

        // Specify output directory
        const outputDir = path.join(__dirname, '../../output');
        // Ensure output directory exists
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const logFilePath = path.join(outputDir, `conversation-log-${user.id}.txt`);

        // Format conversations to a readable JSON format
        const formattedConversations = userConversations.map(conv => ({
            startTime: conv.startTime,
            endTime: conv.endTime,
            messages: conv.messages.map(msg => ({
                author: msg.authorUsername,
                content: msg.content,
                time: msg.createdAt,
            })),
        }));

        // Write formatted conversations to file
        const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
        logStream.write(JSON.stringify(formattedConversations, null, 2)); // `null, 2` formats the JSON with indentation
        logStream.end();

        await interaction.editReply(`Conversations successfully logged to ${logFilePath}`);
    } catch (error) {
        console.error('Error during analysis:', error);
        await interaction.editReply('There was an error analyzing the sentiment.');
    }
}

export async function sendAnalysisResult(
    interaction: ChatInputCommandInteraction,
    username: string,
    analysisResult: string
): Promise<void> {
    if (analysisResult.length <= 2000) {
        await interaction.editReply(
            `Sentiment analysis for ${username}:\n${analysisResult}`
        );
    } else {
        const attachment = new AttachmentBuilder(Buffer.from(analysisResult, 'utf-8'), {
            name: 'analysis.txt',
        });
        await interaction.editReply({
            content: `Sentiment analysis for ${username}:`,
            files: [attachment],
        });
    }
}
