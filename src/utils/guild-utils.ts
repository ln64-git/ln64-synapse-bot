import { Guild, TextChannel, ChannelType, Snowflake, PermissionsBitField, User, GuildMember, Message } from 'discord.js';
import pLimit from 'p-limit';

// Utility function to check channel permissions
async function checkChannelPermissions(textChannel: TextChannel, guild: Guild): Promise<boolean> {
  const permissions = textChannel.permissionsFor(guild.members.me!);
  return permissions?.has(PermissionsBitField.Flags.ViewChannel) && permissions.has(PermissionsBitField.Flags.ReadMessageHistory);
}

// Utility function to fetch messages from a guild
export async function fetchMessagesFromGuild(
  guild: Guild,
  sinceDate: Date | undefined,
  filterFn: (msg: Message) => boolean,
  maxMessages: number = 1000,
  maxMessagesPerChannel: number = 500
): Promise<Message[]> {
  const messages: Message[] = [];
  let collectedMessageCount = 0;

  // Fetch all text-based channels
  const channels = guild.channels.cache.filter(channel => channel.type === ChannelType.GuildText);

  // Limit concurrency to prevent hitting rate limits
  const limit = pLimit(5);

  await Promise.all(
    channels.map(channel =>
      limit(async () => {
        const textChannel = channel as TextChannel;
        const hasPermission = await checkChannelPermissions(textChannel, guild);
        if (!hasPermission) {
          console.error(`Skipping channel ${textChannel.name}: Missing permissions`);
          return;
        }

        let lastMessageId: Snowflake | undefined;
        let fetchComplete = false;
        let channelMessagesFetched = 0;

        while (!fetchComplete && collectedMessageCount < maxMessages && channelMessagesFetched < maxMessagesPerChannel) {
          const options = { limit: 100, before: lastMessageId };
          const fetchedMessages = await textChannel.messages.fetch(options);

          if (fetchedMessages.size === 0) break;
          channelMessagesFetched += fetchedMessages.size;

          for (const msg of fetchedMessages.values()) {
            // Apply the filtering function (e.g., user-specific, mention-specific)
            if (!filterFn(msg)) continue;
            if (sinceDate && msg.createdAt < sinceDate) {
              fetchComplete = true;
              break;
            }
            messages.push(msg);
            collectedMessageCount++;
            if (collectedMessageCount >= maxMessages) {
              fetchComplete = true;
              break;
            }
          }
          lastMessageId = fetchedMessages.last()?.id;
          if (fetchedMessages.size < 100) break;
        }
      })
    )
  );

  return messages;
}

export async function collectUserList(guild: Guild): Promise<GuildMember[]> {
  try {
    await guild.members.fetch(); // Fetch all members to ensure the cache is populated

    const members: GuildMember[] = guild.members.cache.map((member: GuildMember) => member);

    console.log(`Collected ${members.length} members from the guild.`);
    return members;
  } catch (error) {
    console.error('Error collecting user list:', error);
    throw new Error('Failed to collect user list.');
  }
}

