import {
    ChatInputCommandInteraction,
    Guild,
    GuildChannel,
    GuildMember,
    SlashCommandBuilder,
    TextChannel,
} from "discord.js";
import {
    connectToDatabase,
    insertChannel,
    insertGuild,
    insertMember,
    insertMembersFromMessages,
    insertMessages,
} from "../database/db";
import {
    checkChannelPermissions,
    fetchMessagesFromGuildChannel,
} from "../discord/guild-utils";

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

        // Sync all channels in the guild
        await syncAllChannels(interaction.guild);

        console.log("Sync process completed.");

        await interaction.editReply("Server synchronization completed.");
    } catch (error) {
        console.error("Error mapping data to the database:", error);
        await interaction.editReply(
            "An error occurred while mapping data to the database.",
        );
    }
}

// Sync Guild Data
async function syncGuild(guild: Guild) {
    console.log(`Syncing guild: ${guild.name} (ID: ${guild.id})`);
    await insertGuild(guild);
    console.log(`Guild ${guild.name} inserted/updated in the database.`);
}

// Sync All Members in the Guild
async function syncAllMembers(guild: Guild) {
    console.log(`Syncing members for guild: ${guild.name} (ID: ${guild.id})`);
    const members = await guild.members.fetch();
    // Use Promise.all to sync members concurrently
    await Promise.all(
        members.map((member) => syncMember(member, guild.id)),
    );
    console.log(
        `Members of guild ${guild.name} inserted/updated in the database.`,
    );
}

// Sync Individual Member
async function syncMember(member: GuildMember, guildId: string) {
    await insertMember(member, guildId);
    console.log(
        `Member ${member.user.tag} inserted/updated in the database.`,
    );
}

// Sync All Channels in the Guild
async function syncAllChannels(guild: Guild) {
    console.log(`Syncing channels for guild: ${guild.name} (ID: ${guild.id})`);
    const channels = guild.channels.cache;

    // Use Promise.all to sync channels concurrently
    await Promise.all(
        channels.map(async (channel) => {
            if (channel instanceof GuildChannel) {
                await syncChannel(channel, guild);
            }
        }),
    );

    console.log(
        `Channels of guild ${guild.name} inserted/updated in the database.`,
    );
}

// Sync Individual Channel
async function syncChannel(channel: GuildChannel, guild: Guild) {
    await insertChannel(channel, guild.id);
    console.log(
        `Channel ${channel.name} inserted/updated in the database.`,
    );
    if (
        // If the channel is text-based and not excluded, sync messages
        channel.isTextBased() &&
        channel.name !== "fireside-chat"
    ) {
        await syncMessagesInChannel(channel as TextChannel, guild);
    }
}

// Sync Messages in a Channel
async function syncMessagesInChannel(channel: TextChannel, guild: Guild) {
    console.log(`Syncing messages for channel: ${channel.name} (ID: ${channel.id})`);
    // Check permissions
    if (!(await checkChannelPermissions(channel, guild))) {
        console.log(`Skipping channel ${channel.name} due to insufficient permissions.`);
        return;
    }
    try {
        // Fetch and insert messages
        const messages = await fetchMessagesFromGuildChannel(channel);
        console.log(`Fetched ${messages.length} messages from channel ${channel.name}.`);

        await Promise.all([
            insertMembersFromMessages(messages, guild.id, guild.client),
            insertMessages(messages, channel.id)
        ]);
        console.log(`Messages from channel ${channel.name} inserted/updated in the database.`);
    } catch (error) {
        console.error(`Error fetching or inserting messages for channel ${channel.name}:`, error);
    }
}
