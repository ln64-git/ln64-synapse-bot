// getFiresideMessages.ts

import {
  Attachment as DiscordAttachment,
  Collection,
  Guild,
  Message,
  type Snowflake,
  TextChannel,
} from "discord.js";
import type { FiresideMessage } from "../../types";

export async function getFiresideMessages(
  guild: Guild,
): Promise<FiresideMessage[]> {
  const channelId = process.env.CHANNEL_ID;
  if (!channelId) {
    throw new Error("CHANNEL_ID is not set in environment variables.");
  }

  const channel = guild.channels.resolve(channelId) as TextChannel;
  if (!channel) {
    throw new Error(`Channel with ID ${channelId} not found.`);
  }

  // Fetch messages and ensure correct type
  const fetchedMessages: Collection<
    Snowflake,
    Message<true>
  > = await channel.messages.fetch({ limit: 100 });

  // Convert Collection to an array of Message<true>
  const messagesArray: Message<true>[] = Array.from(fetchedMessages.values());

  // Map over the array
  const firesideMessages: FiresideMessage[] = messagesArray.map((message) => ({
    displayName: message.member?.displayName || message.author.username,
    messageContent: message.content,
    attachments: message.attachments.map((attachment: DiscordAttachment) => ({
      url: attachment.url,
      // Initialize summary and ocrText as empty strings; they'll be populated later
      summary: "",
      ocrText: "",
    })),
    timestamp: message.createdAt.toISOString(),
    embedding: [],
  }));

  // Sort messages and save to JSON
  const sortedMessages = firesideMessages.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const encoder = new TextEncoder();
  const json = JSON.stringify(sortedMessages, null, 2);
  const fs = require("fs").promises;
  await fs.writeFile("./logs/messages.json", encoder.encode(json));
  return sortedMessages;
}

export async function getMessageById(
  guild: Guild,
  messageId: Snowflake,
): Promise<Message<true> | null> {
  const channelId = process.env.CHANNEL_ID;
  if (!channelId) {
    throw new Error("CHANNEL_ID is not set in environment variables.");
  }

  const channel = guild.channels.resolve(channelId) as TextChannel;
  if (!channel) {
    throw new Error(`Channel with ID ${channelId} not found.`);
  }

  try {
    const message = await channel.messages.fetch(messageId);
    return message as Message<true>;
  } catch (error) {
    console.error(`Failed to fetch message with ID ${messageId}:`, error);
    return null; // Return null if the message is not found or another error occurs
  }
}
