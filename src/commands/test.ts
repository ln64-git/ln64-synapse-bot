import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    TextChannel,
} from "discord.js";
import { connectToDatabase } from "../database/db";
import { exportChannelData } from "../function/export-guild-data";

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

        // Find the channel named "Gaming"
        const gamingChannel = guild.channels.cache.find(
            (channel) =>
                channel.name === "gaming" && channel instanceof TextChannel,
        ) as TextChannel | undefined;

        if (!gamingChannel) {
            return await interaction.editReply("Channel 'Gaming' not found.");
        }

        // Export the channel data
        await exportChannelData(guild.client, gamingChannel, guild.id);

        await interaction.editReply(
            "Channel 'Gaming' data has been exported successfully.",
        );
    } catch (error) {
        console.error("Error mapping data to the database:", error);
        await interaction.editReply(
            "An error occurred while mapping data to the database.",
        );
    }
}
