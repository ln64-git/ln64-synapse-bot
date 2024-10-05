import { Guild, TextChannel, ChannelType, Snowflake, PermissionsBitField, User, GuildMember } from 'discord.js';
import type { MessageData, UserData } from '../types';
import pLimit from 'p-limit';

export async function collectMessagesFromGuild(
  guild: Guild,
  user: User,
  sinceDate?: Date,
  maxMessages: number = 1000,
  maxMessagesPerChannel: number = 500
): Promise<MessageData[]> {
  const messages: MessageData[] = [];
  let collectedMessageCount = 0;

  const channels = guild.channels.cache.filter(
    (channel) => channel.type === ChannelType.GuildText
  );

  // Limit concurrency to prevent hitting rate limits
  const limit = pLimit(5); // Adjust the concurrency level as needed

  await Promise.all(
    channels.map((channel) =>
      limit(async () => {
        if (collectedMessageCount >= maxMessages) {
          return;
        }

        // Permission Checks
        const textChannel = channel as TextChannel;
        const permissions = textChannel.permissionsFor(guild.members.me!);
        if (
          !permissions?.has(PermissionsBitField.Flags.ViewChannel) ||
          !permissions.has(PermissionsBitField.Flags.ReadMessageHistory)
        ) {
          console.error(`Skipping channel ${textChannel.name}: Missing permissions`);
          return;
        }

        try {
          let lastMessageId: Snowflake | undefined;
          let fetchComplete = false;
          let channelMessagesFetched = 0;

          while (
            !fetchComplete &&
            collectedMessageCount < maxMessages &&
            channelMessagesFetched < maxMessagesPerChannel
          ) {
            // Fetch messages in batches of 100
            const options = { limit: 100 } as { limit: number; before?: Snowflake };
            if (lastMessageId) {
              options.before = lastMessageId;
            }

            const fetchedMessages = await textChannel.messages.fetch(options);
            if (fetchedMessages.size === 0) {
              break;
            }

            channelMessagesFetched += fetchedMessages.size;

            for (const msg of fetchedMessages.values()) {
              // Only collect messages from the specific user
              if (msg.author.id !== user.id || !msg.content || msg.author.bot) continue;

              // Check if the message is within the time frame
              if (sinceDate && msg.createdAt < sinceDate) {
                fetchComplete = true;
                break;
              }

              messages.push({
                content: msg.content,
                createdAt: msg.createdAt,
                authorId: msg.author.id,
                authorUsername: msg.author.username,
                channelId: msg.channel.id,
                channelName: msg.channel.name,
              });
              collectedMessageCount++;

              if (collectedMessageCount >= maxMessages) {
                fetchComplete = true;
                break;
              }
            }

            lastMessageId = fetchedMessages.last()?.id;
            if (fetchedMessages.size < 100) {
              break;
            }
          }
        } catch (error) {
          console.error(`Error fetching messages from channel ${textChannel.name}:`, error);
        }
      })
    )
  );

  console.log(`Total messages collected from user ${user.username}: ${messages.length}`);
  return messages;
}

export async function collectUserList(guild: Guild): Promise<UserData[]> {
  try {
    await guild.members.fetch(); // Fetch all members to ensure the cache is populated

    const users: UserData[] = guild.members.cache.map((member: GuildMember) => ({
      userId: member.user.id,
      username: member.user.username,
      nickname: member.nickname || member.user.username, // Use username if nickname is not set
    }));

    console.log(`Collected ${users.length} users from the guild.`);
    return users;
  } catch (error) {
    console.error('Error collecting user list:', error);
    throw new Error('Failed to collect user list.');
  }
}

