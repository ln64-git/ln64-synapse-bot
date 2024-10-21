import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    TextChannel,
} from "discord.js";
import {
    connectToDatabase,
    getChannelsByGuildId,
    getMessagesByChannelId,
} from "../database/db";
import { exportGuildData } from "../function/export-guild-data";

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

        const channels = await getChannelsByGuildId(guild.id);

        for (const channel of channels) {
            // Replace the channel ID string below with the ID of the channel you want to check
            if (channel.id === "1004111008337502270") {
                console.log(`Processing channel: ${channel.name}`);

                // Fetch messages from the database instead of Discord
                const messages = await getMessagesByChannelId(channel.id);

                console.log(
                    `Fetched ${messages.length} messages from channel: ${channel.name}`,
                );

                for (const message of messages) {
                    const user = await interaction.client.users.fetch(
                        message.authorId,
                    );
                    console.log(
                        `Message from ${user.username}: ${message.content}`,
                    );
                }
            } else {
            }
        }
        // Dump guild data
        // await exportGuildData(guild);
        // console.log("Guild data dumped.");

        // const channels = await getChannelsByGuildId(guild.id);
        // console.log("Channels:", channels);

        await interaction.editReply(
            "Successfully mapped all guilds, channels, members, and messages to the database.",
        );
    } catch (error) {
        console.error("Error mapping data to the database:", error);
        await interaction.editReply(
            "An error occurred while mapping data to the database.",
        );
    }
}
