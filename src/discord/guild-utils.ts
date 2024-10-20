import {
  ChannelType,
  Guild,
  GuildMember,
  Message,
  PermissionsBitField,
  Snowflake,
  TextChannel,
  User,
} from "discord.js";
import pLimit from "p-limit";

// Utility function to check channel permissions
async function checkChannelPermissions(
  textChannel: TextChannel,
  guild: Guild,
): Promise<boolean> {
  const permissions = textChannel.permissionsFor(guild.members.me!);
  return permissions?.has(PermissionsBitField.Flags.ViewChannel) &&
    permissions.has(PermissionsBitField.Flags.ReadMessageHistory);
}

// Utility function to fetch messages from a specific channel
export async function fetchMessagesFromGuildChannel(
  textChannel: TextChannel,
  sinceDate: Date | undefined,
  filterFn: (msg: Message) => boolean,
  maxMessages: number = 500,
): Promise<Message[]> {
  const messages: Message[] = [];
  let lastMessageId: Snowflake | undefined;
  let collectedMessageCount = 0;

  while (collectedMessageCount < maxMessages) {
    const options = { limit: 100, before: lastMessageId };
    const fetchedMessages = await textChannel.messages.fetch(options);

    if (fetchedMessages.size === 0) break;

    for (const msg of fetchedMessages.values()) {
      if (!filterFn(msg)) continue;
      if (sinceDate && msg.createdAt < sinceDate) {
        return messages;
      }
      messages.push(msg);
      collectedMessageCount++;
      if (collectedMessageCount >= maxMessages) {
        return messages;
      }
    }
    lastMessageId = fetchedMessages.last()?.id;
    if (fetchedMessages.size < 100) break;
  }

  return messages;
}

// Utility function to fetch messages from a guild
export async function fetchMessagesFromGuild(
  guild: Guild,
  sinceDate: Date | undefined,
  filterFn: (msg: Message) => boolean,
  maxMessages: number = 1000,
  maxMessagesPerChannel: number = 500,
): Promise<Message[]> {
  const messages: Message[] = [];
  let collectedMessageCount = 0;

  // Fetch all text-based channels
  const channels = guild.channels.cache.filter((channel) =>
    channel.type === ChannelType.GuildText
  );

  // Limit concurrency to prevent hitting rate limits
  const limit = pLimit(5);

  await Promise.all(
    channels.map((channel) =>
      limit(async () => {
        const textChannel = channel as TextChannel;
        const hasPermission = await checkChannelPermissions(textChannel, guild);
        if (!hasPermission) {
          console.error(
            `Skipping channel ${textChannel.name}: Missing permissions`,
          );
          return;
        }

        let lastMessageId: Snowflake | undefined;
        let fetchComplete = false;
        let channelMessagesFetched = 0;

        while (
          !fetchComplete && collectedMessageCount < maxMessages &&
          channelMessagesFetched < maxMessagesPerChannel
        ) {
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
    ),
  );

  return messages;
}

export async function fetchMembersFromGuild(
  guild: Guild,
): Promise<GuildMember[]> {
  try {
    await guild.members.fetch(); // Fetch all members to ensure the cache is populated

    const members: GuildMember[] = guild.members.cache.map((
      member: GuildMember,
    ) => member);

    console.log(`Collected ${members.length} members from the guild.`);
    return members;
  } catch (error) {
    console.error("Error collecting user list:", error);
    throw new Error("Failed to collect user list.");
  }
}

// Collect mentions of a user
export async function fetchMentionsFromGuild(
  guild: Guild,
  user: GuildMember,
  days?: number,
): Promise<Message[]> {
  if (!user || !user.user) {
    throw new Error("Invalid user object");
  }

  const sinceDate = days
    ? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    : undefined;

  const aliases = [
    user.displayName.toLowerCase(),
    user.user.username?.toLowerCase() || "",
  ];

  console.log("Aliases:", aliases);

  if (!user.user.username) {
    console.error(`No valid username for the user: ${user.displayName}`);
    return [];
  }

  const mentions = await fetchMessagesFromGuild(
    guild,
    sinceDate,
    (msg) => {
      const contentLower = msg.content.toLowerCase();
      const hasDirectMention = msg.mentions.users.has(user.id);
      const hasIndirectMention = aliases.some((alias) =>
        contentLower.includes(alias)
      );
      return hasDirectMention || hasIndirectMention;
    },
  );

  return mentions;
}
