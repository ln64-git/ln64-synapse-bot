import {
  Attachment,
  Channel,
  ChatInputCommandInteraction,
  Collection,
  Guild,
  GuildMember,
  Message,
  PermissionsBitField,
  Snowflake,
  TextChannel,
} from "npm:discord.js";
import type { Db } from "npm:mongodb@5.6.0";
import OpenAI from "npm:openai";
import type { DiscordMessageWithEmbedding } from "../types.ts";
const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") });

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

export async function syncMembersToDatabase(
  guild: Guild,
  db: Db,
): Promise<void> {
  const membersCollection = db.collection("members");
  const limit = 1000;
  let lastMemberId: Snowflake | undefined;

  while (true) {
    // Use 'after' instead of 'lastMemberId'
    const fetchedMembers = await guild.members.fetch({
      limit,
      after: lastMemberId, // Use 'after' to paginate
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

  console.info(`syncMembersToDatabase completed.`);
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
      const messageData = message.toJSON() as DiscordMessageWithEmbedding;

      // Use the attachment's `toJSON()` to include the full attachment object
      messageData.attachments = message.attachments.map((
        attachment: Attachment,
      ) => attachment.toJSON());

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

export async function syncMessagesToDatabaseWithEmbeddings(
  channel: TextChannel,
  db: Db,
): Promise<void> {
  if (!(await checkChannelPermissions(channel, channel.guild))) {
    return;
  }

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

      // Convert attachments to JSON-compatible format
      messageData.attachments = message.attachments.map((
        attachment: Attachment,
      ) => attachment.toJSON());

      // Generate vector embeddings for the message content if it's not empty
      if (message.cleanContent.length > 0) {
        const embeddingResponse = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: message.cleanContent,
          encoding_format: "float",
        });
        if (embeddingResponse.data.length > 0) {
          messageData.cleanContentEmbedding =
            embeddingResponse.data[0].embedding;
        }
      }

      await messagesCollection.updateOne(
        { id: message.id },
        { $set: messageData },
        { upsert: true },
      );
    }

    lastMessageId = fetchedMessages.last()?.id;
    if (fetchedMessages.size < 100) {
      break;
    }
  }
}
