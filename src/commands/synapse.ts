// src/commands/synapse.ts
import { SlashCommandBuilder } from "@discordjs/builders";
import { ChatInputCommandInteraction } from "discord.js";
import { GuildMember } from "discord.js";
import { Conversation } from "../types";
import {
    getMessagesByAuthorId,
    getMessagesByMentionedUserId,
} from "../database/db";
import { assembleConversations } from "../utils/conversation-utils";

export const data = new SlashCommandBuilder()
    .setName("synapse")
    .setDescription(
        "Analyzes a user's messages for sentiment and provides insights.",
    )
    .addUserOption((option) =>
        option.setName("user").setDescription("The user to analyze")
            .setRequired(true)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    if (!interaction.guild) throw new Error("Guild is null.");
    const user = interaction.options.getMember("user") as GuildMember;

    try {
        // Step 1: Collect Messages from the User

        // Step 2: Collect Mentions of the User

        // Step 3: Collect indirect mentions of the user

        // Step 4: Build Conversations

        // Step 5: Concotenate Conversations

        // Step 6: Analyze Sentiment Using the Agent

        // Step 7: Handle Results (Send to Discord and Save as TXT)

        console.info(`Handling results for user: ${user.user.username}`);
        await interaction.editReply(
            `Analysis complete for user: ${user.user.tag}`,
        );
    } catch (error) {
        console.error(
            `Error during synapse analysis: ${(error as Error).message}`,
        );
        await interaction.editReply(
            "An error occurred during synapse analysis.",
        );
    }
}

export async function assembleSynapse(
    user: GuildMember,
): Promise<Conversation[]> {
    console.info(`Starting to assemble background for user: ${user.user.tag}`);

    // Fetch user messages from the database
    console.info(`Fetching messages authored by user: ${user.user.tag}`);
    const userMessages = await getMessagesByAuthorId(user.id);
    console.info(
        `Fetched ${userMessages.length} messages authored by user: ${user.user.tag}`,
    );

    // Fetch messages mentioning the user from the database
    console.info(`Fetching messages mentioning user: ${user.user.tag}`);
    const userMentions = await getMessagesByMentionedUserId(user.id);
    console.info(
        `Fetched ${userMentions.length} messages mentioning user: ${user.user.tag}`,
    );

    // Aggregate conversations
    console.info(`Aggregating conversations for user: ${user.user.tag}`);
    const allMessages = [...userMessages, ...userMentions];
    const conversations = await assembleConversations(allMessages);
    console.info(
        `Assembled ${conversations.length} conversations for user: ${user.user.tag}`,
    );

    return conversations;
}
