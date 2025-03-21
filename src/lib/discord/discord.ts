import {
  Client,
  Collection,
  Guild,
  Message,
  type Snowflake,
  TextChannel,
} from "discord.js";
import { saveLog } from "../../utils/logger";
import { convertToTrimmedMessage } from "../../utils/utils";

export async function getMessages(
  guild: Guild,
  channelId: string,
  count: number = 30,
): Promise<Message<true>[]> {
  if (!channelId || channelId == "") throw new Error("CHANNEL_ID missing");
  const channel = await guild.channels.fetch(channelId);
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error("Channel not found or not a text channel.");
  }

  try {
    const fetchedMessages = await channel.messages.fetch({ limit: count });
    const convertedMessages = [...fetchedMessages.values()]
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
      .map(convertToTrimmedMessage);

    await saveLog(convertedMessages, "firesideMessages");

    return [...fetchedMessages.values()];
  } catch (error) {
    if ((error as any).code === 10008) {
      console.error("Unknown Message error: The message does not exist.");
    } else {
      console.error("Error fetching messages:", error);
    }
    return [];
  }
}

export async function getFiresideMessages(
  client: Client,
): Promise<Message<true>[]> {
  const hearth = await client.guilds.fetch(process.env.GUILD_ID!);
  const channelId = process.env.FIRESIDE_CHANNEL_ID;
  if (!channelId) {
    throw new Error("CHANNEL_ID is not set in environment variables.");
  }

  const channel = hearth.channels.resolve(channelId) as TextChannel;
  if (!channel) {
    throw new Error(`Channel with ID ${channelId} not found.`);
  }

  // Fetch the latest 100 messages
  const fetchedMessages: Collection<Snowflake, Message<true>> = await channel
    .messages.fetch({ limit: 100 });

  // Convert Collection to an array of Message<true>
  const messagesArray: Message<true>[] = Array.from(fetchedMessages.values());

  // Sort messages by timestamp in descending order (latest first)
  const sortedMessages = messagesArray.sort(
    (a, b) => b.createdTimestamp - a.createdTimestamp,
  );

  // Ensure only the latest 100 messages are processed (this is redundant but guarantees correctness)
  const latestMessages = sortedMessages.slice(0, 100);

  // Convert messages to trimmed format for logging
  const trimmedMessages = latestMessages.map((message) =>
    convertToTrimmedMessage(message)
  );

  // Save the trimmed messages to log
  await saveLog(trimmedMessages, "firesideMessages");

  return latestMessages;
}
