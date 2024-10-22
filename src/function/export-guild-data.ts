import { Client, Guild, GuildChannel, TextChannel } from "discord.js";
import {
    checkChannelPermissions,
    fetchMessagesFromGuildChannel,
} from "../discord/guild-utils";
import {
    getChannelsByGuildId,
    insertChannel,
    insertGuild,
    insertMember,
    insertMembersFromMessages,
    insertMessages,
} from "../database/db";

export async function exportGuildData(guild: Guild) {
    console.log(`Starting export for guild: ${guild.name} (ID: ${guild.id})`);

    // Insert or update the guild
    await insertGuild(guild);
    console.log(`Guild ${guild.name} inserted/updated in the database.`);

    // Fetch and insert members of the guild
    const members = await guild.members.fetch();
    for (const member of members.values()) {
        await insertMember(member, guild.id);
    }
    console.log(
        `Members of guild ${guild.name} inserted/updated in the database.`,
    );

    // Process all channels in the guild
    const channels = guild.channels.cache;
    for (const [channelId, channel] of channels) {
        // Check if the channel is already in the database
        const existingChannels = await getChannelsByGuildId(guild.id);
        const channelExists = existingChannels.some(
            (ch: any) => ch.id === channelId,
        );

        // Insert the channel if it does not exist
        if (!channelExists) {
            if (channel instanceof GuildChannel) {
                await insertChannel(channel, guild.id);
                console.log(
                    `Channel ${channel.name} inserted in the database.`,
                );
            }
            console.log(`Channel ${channel.name} inserted in the database.`);
        }

        // Export channel data if it is text-based and not named "fireside-chat"
        if (channel.isTextBased() && channel.name !== "fireside-chat") {
            await exportChannelData(
                guild.client,
                channel as TextChannel,
                guild.id,
            );
        }
    }

    console.log(`Export completed for guild: ${guild.name} (ID: ${guild.id})`);
}
export async function exportChannelData(
    client: Client,
    channel: TextChannel,
    guildId: string,
) {
    console.log(
        `Starting export for channel: ${channel.name} (ID: ${channel.id})`,
    );

    // Ensure the guild is inserted before the channel to avoid foreign key violation
    if (channel instanceof GuildChannel) {
        await insertChannel(channel, guildId);
        console.log(
            `Channel ${channel.name} inserted/updated in the database.`,
        );
    }

    // Insert or update the channel
    await insertChannel(channel, guildId);
    console.log(`Channel ${channel.name} inserted/updated in the database.`);

    // Check permissions
    const hasPermissions = await checkChannelPermissions(
        channel,
        channel.guild,
    );
    if (!hasPermissions) {
        console.log(
            `Skipping channel ${channel.name} due to insufficient permissions.`,
        );
        return;
    }

    // Fetch messages from the channel
    try {
        const messages = await fetchMessagesFromGuildChannel(channel);
        console.log(
            `Fetched ${messages.length} messages from channel ${channel.name}.`,
        );

        // Insert members (authors) from the messages
        await insertMembersFromMessages(messages, guildId, client);

        // Insert the messages into the database
        await insertMessages(messages, channel.id);
    } catch (error) {
        console.error(
            `Error fetching or inserting messages for channel ${channel.name}:`,
            error,
        );
    }
}

export async function exportGuildMemberData(guild: Guild, memberId: string) {
    console.log(
        `Starting export for member: ${memberId} in guild: ${guild.name} (ID: ${guild.id})`,
    );

    // Insert or update the guild
    await insertGuild(guild);
    console.log(`Guild ${guild.name} inserted/updated in the database.`);

    // Fetch and insert the member
    const member = await guild.members.fetch(memberId);
    await insertMember(member, guild.id);
    console.log(`Member ${memberId} inserted/updated in the database.`);

    // Fetch and insert all members of the guild
    const members = await guild.members.fetch();
    for (const member of members.values()) {
        await insertMember(member, guild.id);
    }
    console.log(
        `All members of guild ${guild.name} inserted/updated in the database.`,
    );

    // Process all text channels in the guild
    const channels = guild.channels.cache;
    for (const [channelId, channel] of channels) {
        if (channel.isTextBased()) {
            await exportChannelData(
                guild.client,
                channel as TextChannel,
                guild.id,
            );
        }
    }

    console.log(
        `Export completed for member: ${memberId} in guild: ${guild.name} (ID: ${guild.id})`,
    );
}
