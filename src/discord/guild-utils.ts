import {
  Channel,
  ChatInputCommandInteraction,
  Collection,
  Guild,
  type GuildBasedChannel,
  GuildMember,
  Message,
  PermissionsBitField,
  Snowflake,
  TextChannel,
} from "npm:discord.js";
import pLimit from "npm:p-limit";
import Logger from "npm:@ptkdev/logger";
import process from "node:process";
import { ChannelType } from "npm:discord-api-types/v10";
import type { Db } from "npm:mongodb@5.6.0";

const logger = new Logger();

export function validateInteraction(
  interaction: ChatInputCommandInteraction,
): { guild: Guild; user: GuildMember; days: number | undefined } | string {
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

// Utility function to check channel permissions
export function checkChannelPermissions(
  textChannel: TextChannel,
  guild: Guild, // guild is used to fetch user channels
): Promise<boolean> {
  const permissions = textChannel.permissionsFor(guild.members.me!);
  return Promise.resolve(
    permissions?.has(PermissionsBitField.Flags.ViewChannel) &&
      permissions.has(PermissionsBitField.Flags.ReadMessageHistory),
  );
}

// Utility function to fetch all messages from a specific channel
export async function fetchMessagesFromGuildChannel(
  channel: Channel,
  count?: number,
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

    if (messages.size < 100 || (count && allMessages.length >= count)) {
      // No more messages to fetch or reached the message count limit
      console.log(`No more messages to fetch from channel ${channel.name}`);
      break;
    }

    // Set the last message ID to fetch the next batch
    lastMessageId = messages.last()?.id;
  }

  // If messageCount is specified, slice the array to the required length
  if (count) {
    allMessages = allMessages.slice(0, count);
  }

  // Reverse the order of messages to be from oldest to newest
  allMessages.reverse();

  console.log(
    `Total messages fetched from channel ${channel.name}: ${allMessages.length}`,
  );
  return allMessages;
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
    (channel: GuildBasedChannel) => channel.type === ChannelType.GuildText,
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

  const end = BigInt(Date.now()) * BigInt(1e6);
  logger.info(
    `fetchMemberMentionsFromGuild took ${(end - start) / BigInt(1e6)} ms`,
  );
  return allMessages;
}

// Utility function to fetch all messages from a guild
export async function fetchAllMessagesFromGuild(
  guild: Guild,
): Promise<Message[]> {
  const start = performance.now();
  const limit = pLimit(5); // Limit concurrent requests to avoid rate limits
  const textChannels = guild.channels.cache.filter(
    (channel: GuildBasedChannel) => channel.type === ChannelType.GuildText,
  ) as Map<Snowflake, TextChannel>;

  const allMessages: Message[] = [];

  await Promise.allSettled(
    Array.from(textChannels.values()).map((textChannel: TextChannel) =>
      limit(async () => {
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

// Utility function to get a channel from its ID
export function getChannelFromId(
  guild: Guild,
  channelId: Snowflake,
): GuildBasedChannel | null {
  const channel = guild.channels.cache.get(channelId);
  if (!channel) {
    console.log(
      `Channel with ID ${channelId} not found in guild ${guild.name}`,
    );
    return null;
  }
  return channel;
}

export async function fetchAllMembersFromGuild(
  guild: Guild,
): Promise<GuildMember[]> {
  const members: GuildMember[] = [];
  let lastMemberId: Snowflake | undefined;
  const limit = 1000; // Discord's maximum limit for fetching members

  while (true) {
    console.log(`Fetching members after ID: ${lastMemberId || "start"}`);

    // Fetch members in batches with an optional starting point
    const fetchedMembers = await guild.members.fetch({
      limit,
    }) as Collection<Snowflake, GuildMember>;

    // If no members are fetched, break the loop
    if (fetchedMembers.size === 0) {
      console.log("No more members to fetch.");
      break;
    }

    // Add fetched members to the list
    members.push(...fetchedMembers.values());

    // Update `lastMemberId` for the next batch
    lastMemberId = fetchedMembers.last()?.id;

    // If fetched members are fewer than the limit, we're done
    if (fetchedMembers.size < limit) {
      console.log("Fetched all members.");
      break;
    }
  }

  logger.info(`fetchAllMembersFromGuild took ${performance.now()} ms`);
  console.log(`Total members fetched: ${members.length}`);
  return members;
}

export async function syncMembersToDatabase(
  guild: Guild,
  db: Db,
): Promise<void> {
  const membersCollection = db.collection("members");
  const limit = 1000;
  let lastMemberId: Snowflake | undefined;

  while (true) {
    const fetchedMembers = await guild.members.fetch({
      limit,
      after: lastMemberId,
    }) as Collection<Snowflake, GuildMember>;

    if (fetchedMembers.size === 0) break;

    for (const member of fetchedMembers.values()) {
      const memberData = {
        id: member.id,
        username: member.user.username,
        joinedAt: member.joinedAt,
      };
      await membersCollection.updateOne(
        { id: member.id },
        { $set: memberData },
        { upsert: true },
      );
    }

    lastMemberId = fetchedMembers.last()?.id;
    if (fetchedMembers.size < limit) break;
  }

  logger.info(`syncMembersToDatabase completed.`);
}

export async function syncChannelToDatabase(
  channel: Channel,
  db: Db,
): Promise<void> {
  if (!(channel instanceof TextChannel)) return;

  const channelsCollection = db.collection("channels");
  const channelData = {
    id: channel.id,
    name: channel.name,
    type: channel.type,
  };

  await channelsCollection.updateOne(
    { id: channel.id },
    { $set: channelData },
    { upsert: true },
  );
}

export async function syncMessagesToDatabase(
  channel: TextChannel,
  db: Db,
  count?: number,
): Promise<void> {
  const messagesCollection = db.collection("messages");
  let lastMessageId: string | undefined;

  while (true) {
    const fetchedMessages: Collection<string, Message> = await channel.messages
      .fetch({
        limit: 100,
        before: lastMessageId,
      });

    for (const message of fetchedMessages.values()) {
      // Convert the entire message to JSON format, including attachments
      const messageData = message.toJSON();

      // Use the attachment's `toJSON()` to include the full attachment object
      messageData.attachments = message.attachments.map((attachment: MessageAttachment) =>
        attachment.toJSON()
      );

      await messagesCollection.updateOne(
        { id: message.id },
        { $set: messageData },
        { upsert: true },
      );
    }

    lastMessageId = fetchedMessages.last()?.id;
    if (
      fetchedMessages.size < 100 || (count && fetchedMessages.size >= count)
    ) {
      break;
    }
  }
}

export async function syncGuildToDatabase(guild: Guild, db: Db): Promise<void> {
  const guildCollection = db.collection("guilds");
  const guildData = {
    id: guild.id,
    name: guild.name,
    memberCount: guild.memberCount,
    createdAt: guild.createdAt,
  };

  await guildCollection.updateOne(
    { id: guild.id },
    { $set: guildData },
    { upsert: true },
  );
}
