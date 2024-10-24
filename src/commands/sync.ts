// Import necessary modules and types
import {
    ChatInputCommandInteraction,
    Guild,
    GuildChannel,
    SlashCommandBuilder,
    TextChannel,
} from "discord.js";
import {
    batchInsertChannels,
    batchInsertGuilds,
    batchInsertMembers,
    batchInsertMessages,
    connectToDatabase,
} from "../postgres/db";
import {
    checkChannelPermissions,
    fetchMessagesFromGuildChannel,
} from "../discord/guild-utils";
import pLimit from "p-limit"; // Control concurrency

export const data = new SlashCommandBuilder()
    .setName("sync")
    .setDescription("Synchronize server data with the database");

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    if (!interaction.guild) throw new Error("Guild is null.");

    try {
        // Connect to the database
        await connectToDatabase();

        console.log("Starting sync process...");

        // Sync guild data
        await syncGuild(interaction.guild);

        // Sync all members in the guild
        await syncAllMembers(interaction.guild);

        // Sync all channels and messages in the guild
        await syncAllChannelsAndMessages(interaction.guild);

        console.log("Sync process completed.");

        await interaction.editReply("Server synchronization completed.");
    } catch (error) {
        console.error("Error during synchronization:", error);
        await interaction.editReply(
            "An error occurred while synchronizing data with the database.",
        );
    }
}

// Sync Guild Data
async function syncGuild(guild: Guild) {
    console.log(`Syncing guild: ${guild.name} (ID: ${guild.id})`);
    await batchInsertGuilds([guild]);
    console.log(`Guild ${guild.name} inserted/updated in the database.`);
}

// Sync All Members in the Guild
async function syncAllMembers(guild: Guild) {
    console.log(`Syncing members for guild: ${guild.name} (ID: ${guild.id})`);
    const members = await guild.members.fetch();

    // Batch insert members
    await batchInsertMembers(
        members.map((member) => ({ member, guildId: guild.id })),
    );
    console.log(
        `Members of guild ${guild.name} inserted/updated in the database.`,
    );
}

// Sync All Channels and Messages in the Guild
async function syncAllChannelsAndMessages(guild: Guild) {
    console.log(`Syncing channels for guild: ${guild.name} (ID: ${guild.id})`);
    const channels = guild.channels.cache.filter(
        (channel) =>
            channel instanceof GuildChannel &&
            channel.isTextBased() &&
            channel.name !== "fireside-chat",
    );

    // Batch insert channels
    await batchInsertChannels(
        channels.map((channel) => ({
            channel: channel as GuildChannel,
            guildId: guild.id,
        })),
    );
    console.log(
        `Channels of guild ${guild.name} inserted/updated in the database.`,
    );

    // Control concurrency to avoid hitting rate limits
    const limit = pLimit(5); // Adjust the concurrency level as needed

    // Fetch and insert messages for each channel
    await Promise.all(
        channels.map((channel) =>
            limit(() => syncMessagesInChannel(channel as TextChannel, guild))
        ),
    );
}

// Sync Messages in a Channel
async function syncMessagesInChannel(channel: TextChannel, guild: Guild) {
    console.log(
        `Syncing messages for channel: ${channel.name} (ID: ${channel.id})`,
    );

    // Check permissions
    if (!(await checkChannelPermissions(channel, guild))) {
        console.log(
            `Skipping channel ${channel.name} due to insufficient permissions.`,
        );
        return;
    }

    try {
        // Fetch messages
        const messages = await fetchMessagesFromGuildChannel(channel);
        console.log(
            `Fetched ${messages.length} messages from channel ${channel.name}.`,
        );

        // Batch insert messages and authors
        await batchInsertMessages(messages, guild.id, guild.client);
        console.log(
            `Messages from channel ${channel.name} inserted/updated in the database.`,
        );
    } catch (error) {
        console.error(
            `Error fetching or inserting messages for channel ${channel.name}:`,
            error,
        );
    }
}
