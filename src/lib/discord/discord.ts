// getFiresideMessages.ts

import {
  Attachment as DiscordAttachment,
  Collection,
  Guild,
  Message,
  type Snowflake,
  TextChannel,
} from "discord.js";
import { saveLog } from "../../function/logger";

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
  for (const message of sortedMessages) {
    await saveLog(message, "fetchedMessages");
  }
  return sortedMessages;
}
