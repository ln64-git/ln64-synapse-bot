import {
  ChannelType,
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
  Message,
  PermissionsBitField,
  Snowflake,
  TextChannel,
} from "discord.js";
import pLimit from "p-limit";
import Logger from "@ptkdev/logger";

const logger = new Logger();

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
  const limit = pLimit(10); // Increase concurrency limit

  while (collectedMessageCount < maxMessages) {
    const options = { limit: 100, before: lastMessageId };
    const fetchedMessages = await textChannel.messages.fetch(options);

    if (fetchedMessages.size === 0) break;

    const filteredMessages = await Promise.all(
      fetchedMessages.map((msg) =>
        limit(async () => {
          if (!filterFn(msg)) return null;
          if (sinceDate && msg.createdAt < sinceDate) return null;
          return msg;
        })
      ),
    );

    for (const msg of filteredMessages) {
      if (msg) {
        messages.push(msg);
        collectedMessageCount++;
        if (collectedMessageCount >= maxMessages) {
          return messages;
        }
      }
    }

    lastMessageId = fetchedMessages.last()?.id;
    if (fetchedMessages.size < 100) break;
  }

  return messages;
}

// Utility function to fetch channels where the user has messages
export async function fetchUserChannels(
  guild: Guild,
  userId: Snowflake,
  sinceDate?: Date,
): Promise<TextChannel[]> {
  const textChannels = guild.channels.cache.filter(
    (channel) => channel.type === ChannelType.GuildText,
  ) as Map<Snowflake, TextChannel>;

  const userChannels: TextChannel[] = [];

  await Promise.all(
    Array.from(textChannels.values()).map(async (textChannel) => {
      if (await checkChannelPermissions(textChannel, guild)) {
        const messages = await textChannel.messages.fetch({ limit: 1 });
        if (
          messages.some((msg) =>
            msg.author.id === userId &&
            (!sinceDate || msg.createdAt >= sinceDate)
          )
        ) {
          userChannels.push(textChannel);
        }
      }
    }),
  );

  return userChannels;
}

// Utility function to fetch all messages from channels where the user has sent messages
export async function fetchAllMessagesFromUserChannels(
  guild: Guild,
  userId: Snowflake,
  sinceDate?: Date,
  maxMessages: number = 500,
): Promise<Message[]> {
  const start = process.hrtime.bigint();
  const userChannels = await fetchUserChannels(guild, userId, sinceDate);
  const allMessages: Message[] = [];

  await Promise.all(
    userChannels.map((textChannel: TextChannel) =>
      fetchMessagesFromGuildChannel(
        textChannel,
        sinceDate,
        (msg) => msg.author.id === userId,
        maxMessages,
      ).then((messages) => {
        if (messages.length > 0) {
          logger.info(`User messages found in channel: ${textChannel.name}`);
        }
        allMessages.push(...messages);
      })
    ),
  );

  const end = process.hrtime.bigint();
  logger.info(
    `fetchAllMessagesFromUserChannels took ${(end - start) / BigInt(1e6)} ms`,
  );
  return allMessages;
}

// Utility function to fetch all members from a guild
export async function fetchAllMembersFromGuild(
  guild: Guild,
): Promise<GuildMember[]> {
  const start = performance.now();
  const members: GuildMember[] = [];
  let lastMemberId: Snowflake | undefined;

  while (true) {
    const options = { limit: 1000, after: lastMemberId };
    const fetchedMembers = await guild.members.fetch(options);

    if (fetchedMembers.size === 0) break;

    members.push(...fetchedMembers.values());
    lastMemberId = fetchedMembers.last()?.id;
  }

  const end = performance.now();
  logger.info(`fetchAllMembersFromGuild took ${end - start} ms`);
  return members;
}

// Utility function to fetch a single member from a guild by user ID
export async function fetchMemberFromGuild(
  guild: Guild,
  userId: Snowflake,
): Promise<GuildMember | null> {
  const start = performance.now();
  try {
    const member = await guild.members.fetch(userId);
    const end = performance.now();
    logger.info(`fetchMemberFromGuild took ${end - start} ms`);
    return member;
  } catch (error) {
    console.error(`Failed to fetch member with ID ${userId}:`, error);
    return null;
  }
}

// Utility function to fetch all mentions of a specific member from a guild
export async function fetchMemberMentionsFromGuild(
  guild: Guild,
  userId: Snowflake,
  sinceDate?: Date,
  maxMessages: number = 500,
): Promise<Message[]> {
  const start = process.hrtime.bigint();
  const limit = pLimit(20); // Increase concurrency limit to 20
  const textChannels = guild.channels.cache.filter(
    (channel) => channel.type === ChannelType.GuildText,
  ) as Map<Snowflake, TextChannel>;

  const allMessages: Message[] = [];

  await Promise.all(
    Array.from(textChannels.values()).map((textChannel: TextChannel) =>
      limit(async () => {
        if (await checkChannelPermissions(textChannel, guild)) {
          const messages = await fetchMessagesFromGuildChannel(
            textChannel,
            sinceDate,
            (msg) => msg.mentions.has(userId),
            maxMessages,
          );
          if (messages.length > 0) {
            logger.info(`Mentions found in channel: ${textChannel.name}`);
          }
          allMessages.push(...messages);
        }
      })
    ),
  );

  const end = process.hrtime.bigint();
  logger.info(
    `fetchMemberMentionsFromGuild took ${(end - start) / BigInt(1e6)} ms`,
  );
  return allMessages;
}

export async function validateInteraction(
  interaction: ChatInputCommandInteraction,
): Promise<
  { guild: any; user: GuildMember; days: number | undefined } | string
> {
  const start = performance.now();
  const guild = interaction.guild;
  if (!guild) {
    return "This command can only be used in a server.";
  }
  // Use `getMember` to retrieve the GuildMember object instead of a User object
  const user = interaction.options.getMember("user") as GuildMember;

  // Check if the user is a bot or if we couldn't find the user
  if (!user) {
    return "Could not find the user. Make sure the user is part of the server.";
  }
  if (user.user.bot) {
    return "Cannot analyze messages from bots.";
  }
  const days = interaction.options.getInteger("days") ?? undefined;
  const end = performance.now();
  logger.info(`validateInteraction took ${end - start} ms`);
  return { guild, user, days };
}

// Utility function to fetch all messages from a guild
export async function fetchAllMessagesFromGuild(
  guild: Guild,
  sinceDate?: Date,
  filterFn: (msg: Message) => boolean = () => true,
  maxMessages: number = 500,
): Promise<Message[]> {
  const start = performance.now();
  const limit = pLimit(5); // Limit concurrent requests to avoid rate limits
  const textChannels = guild.channels.cache.filter(
    (channel) => channel.type === ChannelType.GuildText,
  ) as Map<Snowflake, TextChannel>;

  const allMessages: Message[] = [];

  await Promise.all(
    Array.from(textChannels.values()).map((textChannel: TextChannel) =>
      limit(async () => {
        if (await checkChannelPermissions(textChannel, guild)) {
          const messages = await fetchMessagesFromGuildChannel(
            textChannel,
            sinceDate,
            filterFn,
            maxMessages,
          );
          allMessages.push(...messages);
        }
      })
    ),
  );

  const end = performance.now();
  logger.info(`fetchAllMessagesFromGuild took ${end - start} ms`);
  return allMessages;
}
