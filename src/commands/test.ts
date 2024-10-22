import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    TextChannel,
} from "discord.js";
import { connectToDatabase } from "../database/db";
import {
    exportChannelData,
    exportGuildData,
} from "../function/export-guild-data";

export const data = new SlashCommandBuilder()
    .setName("test")
    .setDescription(
        "Download and map all guilds, channels, members, and messages to the database.",
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    const guild = interaction.guild;

    if (!guild) {
        return await interaction.editReply("Guild not found.");
    }

    try {
        // Connect to the database
        await connectToDatabase();

        // Export the channel data
        await exportGuildData(guild);

        await interaction.editReply(
            "Guild has been exported successfully.",
        );
    } catch (error) {
        console.error("Error mapping data to the database:", error);
        await interaction.editReply(
            "An error occurred while mapping data to the database.",
        );
    }
}
