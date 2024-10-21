import { Guild, GuildChannel, TextChannel } from "discord.js";
import {
    checkChannelPermissions,
    fetchAllMembersFromGuild,
    fetchMessagesFromGuildChannel,
} from "../discord/guild-utils";
import {
    insertChannel,
    insertGuild,
    insertMember,
    insertMessages,
} from "../database/db";

export async function exportGuildData(guild: Guild) {
    console.log(`Starting export for guild: ${guild.name} (ID: ${guild.id})`);

    // Insert or update the guild
    await insertGuild(guild);
    console.log(`Guild ${guild.name} inserted/updated in the database.`);

    // Fetch all members of the guild
    const members = await fetchAllMembersFromGuild(guild);
    console.log(`Fetched ${members.length} members from guild ${guild.name}.`);
    for (const member of members) {
        await insertMember(member);
        console.log(`Member ${member.user.tag} inserted into the database.`);
    }

    // Fetch all channels of the guild
    const channels = guild.channels.cache;
    console.log(`Fetched ${channels.size} channels from guild ${guild.name}.`);
    for (const [channelId, channel] of channels) {
        if (channel.isTextBased()) {
            await insertChannel(channel as GuildChannel, guild.id);
            console.log(`Channel ${channel.name} inserted into the database.`);

            // Check if the bot has the required permissions for the channel
            const hasPermissions = await checkChannelPermissions(
                channel as TextChannel,
                guild,
            );
            if (!hasPermissions) {
                console.log(
                    `Skipping channel ${channel.name} due to insufficient permissions.`,
                );
                continue;
            }

            // Fetch messages if permissions are okay
            // try {
            //     const messages = await fetchMessagesFromGuildChannel(
            //         channel as TextChannel,
            //     );
            //     console.log(
            //         `Fetched ${messages.length} messages from channel ${channel.name}.`,
            //     );

            //     // Batch insert messages in chunks of 100
            //     const batchSize = 100;
            //     for (let i = 0; i < messages.length; i += batchSize) {
            //         const messageBatch = messages.slice(i, i + batchSize);
            //         await insertMessages(messageBatch);
            //         console.log(
            //             `Inserted ${messageBatch.length} messages from ${channel.name}.`,
            //         );
            //         console.log(
            //             `${
            //                 messages.length - (i + batchSize)
            //             } messages left to insert from ${channel.name}.`,
            //         );
            //     }
            // } catch (error) {
            //     console.error(
            //         `Error fetching messages from channel ${channel.name}:`,
            //         error,
            //     );
            //     continue; // Skip this channel if there's an error and proceed with the next one
            // }
        }
    }

    // console.log(`Export completed for guild: ${guild.name} (ID: ${guild.id})`);
}
