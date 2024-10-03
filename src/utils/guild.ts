// src/utils/guild.ts

import {
  Guild,
  TextChannel,
  ChannelType,
  Snowflake,
  PermissionsBitField,
  User,
} from 'discord.js';
import type { MessageData } from '../types';

export async function collectMessagesFromGuild(
  guild: Guild,
  user: User,
  sinceDate?: Date,
  maxMessages: number = 1000
): Promise<MessageData[]> {
  const messages: MessageData[] = [];
  let collectedMessageCount = 0;

  const channels = guild.channels.cache.filter(
    (channel) => channel.type === ChannelType.GuildText
  );

  for (const channel of channels.values()) {
    if (collectedMessageCount >= maxMessages) {
      break;
    }

    // Permission Checks
    const textChannel = channel as TextChannel;
    const permissions = textChannel.permissionsFor(guild.members.me!);
    if (
      !permissions?.has(PermissionsBitField.Flags.ViewChannel) ||
      !permissions.has(PermissionsBitField.Flags.ReadMessageHistory)
    ) {
      console.error(`Skipping channel ${textChannel.name}: Missing permissions`);
      continue;
    }

    try {
      let lastMessageId: Snowflake | undefined;
      let fetchComplete = false;

      while (!fetchComplete && collectedMessageCount < maxMessages) {
        // Fetch messages in batches of 100
        const options = { limit: 100 } as { limit: number; before?: Snowflake };
        if (lastMessageId) {
          options.before = lastMessageId;
        }

        const fetchedMessages = await textChannel.messages.fetch(options);

        if (fetchedMessages.size === 0) {
          break;
        }

        for (const msg of fetchedMessages.values()) {
          // Skip messages not from the specified user, without content, or from bots
          if (msg.author.id !== user.id || !msg.content || msg.author.bot) continue;

          // Check if the message is within the time frame
          if (sinceDate && msg.createdAt < sinceDate) {
            fetchComplete = true;
            break;
          }

          messages.push({
            content: msg.content,
            createdAt: msg.createdAt,
            authorId: msg.author.id,
            authorUsername: msg.author.username,
            channelId: msg.channel.id,
            channelName: msg.channel.name,
          });
          collectedMessageCount++;
          if (collectedMessageCount >= maxMessages) {
            fetchComplete = true;
            break;
          }
        }

        lastMessageId = fetchedMessages.last()?.id;
        if (fetchedMessages.size < 100) {
          break;
        }
      }
    } catch (error) {
      console.error(`Error fetching messages from channel ${textChannel.name}:`, error);
    }
  }

  console.log(`Total messages collected from user ${user.username}: ${messages.length}`);
  return messages;
}
