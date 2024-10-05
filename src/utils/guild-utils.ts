import { Guild, TextChannel, ChannelType, Snowflake, PermissionsBitField, User, GuildMember, Message } from 'discord.js';
import pLimit from 'p-limit';

export async function collectMessagesFromGuild(
  guild: Guild,
  user: User,
  sinceDate?: Date,
  maxMessages: number = 1000,
  maxMessagesPerChannel: number = 500
): Promise<Message[]> {
  const messages: Message[] = [];
  let collectedMessageCount = 0;

  const channels = guild.channels.cache.filter(
    (channel) => channel.type === ChannelType.GuildText
  );

  // Limit concurrency to prevent hitting rate limits
  const limit = pLimit(5);

  await Promise.all(
    channels.map((channel) =>
      limit(async () => {
        if (collectedMessageCount >= maxMessages) return;

        const textChannel = channel as TextChannel;
        const permissions = textChannel.permissionsFor(guild.members.me!);
        if (!permissions?.has('ViewChannel') || !permissions.has('ReadMessageHistory')) {
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
            const options = { limit: 100 } as { limit: number; before?: Snowflake };
            if (lastMessageId) options.before = lastMessageId;

            const fetchedMessages = await textChannel.messages.fetch(options);
            if (fetchedMessages.size === 0) break;

            channelMessagesFetched += fetchedMessages.size;

            for (const msg of fetchedMessages.values()) {
              if (msg.author.id !== user.id || !msg.content || msg.author.bot) continue;
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
        } catch (error) {
          console.error(`Error fetching messages from channel ${textChannel.name}:`, error);
        }
      })
    )
  );

  console.log(`Total messages collected from user ${user.username}: ${messages.length}`);
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

