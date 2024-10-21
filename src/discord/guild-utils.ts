import {
  Channel,
  ChannelType,
  ChatInputCommandInteraction,
  Collection,
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
export async function checkChannelPermissions(
  textChannel: TextChannel,
  guild: Guild, // guild is used to fetch user channels
): Promise<boolean> {
  const permissions = textChannel.permissionsFor(guild.members.me!);
  return permissions?.has(PermissionsBitField.Flags.ViewChannel) &&
    permissions.has(PermissionsBitField.Flags.ReadMessageHistory);
}

// Utility function to fetch all messages from a specific channel
export async function fetchMessagesFromGuildChannel(
  channel: Channel,
): Promise<Message[]> {
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error("Invalid channel or not a text channel");
  }

  let allMessages: Message[] = [];
  let lastMessageId: string | undefined;

  while (true) {
    console.log(
      `Fetching messages from channel ${channel.name} before message ID ${lastMessageId}`,
    );
    // Fetch messages in batches of 100
    const messages: Collection<string, Message> = await channel.messages.fetch({
      limit: 100,
      before: lastMessageId,
    });
    allMessages = allMessages.concat(Array.from(messages.values()));
    console.log(
      `Fetched ${messages.size} messages from channel ${channel.name}`,
    );
    console.log(
      `Messages processed: ${allMessages.length}, Messages left to process: ${messages.size}`,
    );
    if (messages.size < 100) {
      // No more messages to fetch
      console.log(`No more messages to fetch from channel ${channel.name}`);
      break;
    }
    // Set the last message ID to fetch the next batch
    lastMessageId = messages.last()?.id;
  }
  console.log(
    `Total messages fetched from channel ${channel.name}: ${allMessages.length}`,
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
  let batchCount = 1;

  // Keep track of the previous lastMemberId to detect if we're stuck in a loop
  let previousLastMemberId: Snowflake | undefined;

  while (true) {
    console.log(`Fetching batch ${batchCount} of members...`);
    const options = { limit: 1000, after: lastMemberId };
    const fetchedMembers = await guild.members.fetch(options);

    console.log(
      `Fetched ${fetchedMembers.size} members in batch ${batchCount}.`,
    );

    // If no members are fetched, exit the loop
    if (fetchedMembers.size === 0) {
      console.log(`No more members to fetch. Exiting at batch ${batchCount}.`);
      break;
    }

    // Add the fetched members to the list
    members.push(...fetchedMembers.values());

    // Update lastMemberId for the next batch
    lastMemberId = fetchedMembers.last()?.id;

    // Check if lastMemberId hasn't changed (indicating we might be in a loop)
    if (lastMemberId === previousLastMemberId) {
      console.log(
        `Warning: lastMemberId has not changed. Stopping to prevent infinite loop.`,
      );
      break;
    }

    // Update the previous lastMemberId to track changes in the next loop iteration
    previousLastMemberId = lastMemberId;

    // If lastMemberId is undefined, break to prevent infinite loop
    if (!lastMemberId) {
      console.log("Reached the end of member list.");
      break;
    }

    // Increment the batch count
    batchCount++;
  }

  const end = performance.now();
  logger.info(`fetchAllMembersFromGuild took ${end - start} ms`);
  console.log(`Total members fetched: ${members.length}`);
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
): Promise<Message[]> {
  const start = process.hrtime.bigint();
  const limit = pLimit(5);
  const textChannels = guild.channels.cache.filter(
    (channel) => channel.type === ChannelType.GuildText,
  ) as Map<Snowflake, TextChannel>;

  const allMessages: Message[] = [];

  await Promise.all(
    Array.from(textChannels.values()).map((textChannel: TextChannel) =>
      limit(async () => {
        logger.info(
          `fetching messages from channel ${textChannel.name}... `,
        );

        try {
          if (await checkChannelPermissions(textChannel, guild)) {
            const messages = await fetchMessagesFromGuildChannel(
              textChannel,
            );
            if (messages.length > 0) {
              logger.info(`Mentions found in channel: ${textChannel.name}`);
            }
            allMessages.push(...messages);
          }
        } catch (error) {
          logger.error(
            `Error fetching messages from channel ${textChannel.name}: ${error}`,
          );
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

  await Promise.allSettled(
    Array.from(textChannels.values()).map((textChannel: TextChannel) =>
      limit(async () => {
        logger.info(`Fetching messages from channel ${textChannel.name}...`);
        try {
          if (await checkChannelPermissions(textChannel, guild)) {
            const messages = await fetchMessagesFromGuildChannel(
              textChannel,
            );
            allMessages.push(...messages);
          }
        } catch (error) {
          logger.error(
            `Error fetching messages from channel ${textChannel.name}: ${error}`,
          );
        }
      })
    ),
  );

  const end = performance.now();
  logger.info(`fetchAllMessagesFromGuild took ${end - start} ms`);
  return allMessages;
}
