// getFiresideMessages.ts

import {
  Attachment as DiscordAttachment,
  Collection,
  Guild,
  Message,
  type Snowflake,
  TextChannel,
} from "discord.js";
import * as fs from "fs/promises"; // Use promises version of fs

export async function getFiresideMessages(
  guild: Guild,
): Promise<Message<true>[]> {
  const channelId = process.env.CHANNEL_ID;
  if (!channelId) {
    throw new Error("CHANNEL_ID is not set in environment variables.");
  }

  const channel = guild.channels.resolve(channelId) as TextChannel;
  if (!channel) {
    throw new Error(`Channel with ID ${channelId} not found.`);
  }

  // Fetch messages and ensure correct type
  const fetchedMessages: Collection<Snowflake, Message<true>> = await channel
    .messages.fetch({ limit: 100 });

  // Convert Collection to an array of Message<true>
  const messagesArray: Message<true>[] = Array.from(fetchedMessages.values());

  // Optionally, sort messages
  const sortedMessages = messagesArray.sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp,
  );

  // Optionally, write messages to JSON for logging purposes
  const messagesForLogging = sortedMessages.map((message) => ({
    id: message.id,
    content: message.content,
    displayName: message.member?.displayName || message.author.username,
    timestamp: message.createdAt.toISOString(),
    attachments: message.attachments.map((attachment: DiscordAttachment) => ({
      url: attachment.url,
      name: attachment.name,
    })),
    mentions: message.mentions.users.map((user) => ({
      id: user.id,
      username: user.username,
    })),
    referencedMessageId: message.reference?.messageId || null,
  }));

  const json = JSON.stringify(messagesForLogging, null, 2);
  await fs.writeFile("./logs/messages.json", json);

  return sortedMessages;
}
