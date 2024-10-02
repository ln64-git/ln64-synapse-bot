// src/utils/collect-user-conversations.ts

import { Guild, User, TextChannel, Snowflake, PermissionsBitField, ChannelType } from 'discord.js';
import type { Conversation, MessageData } from '../types';
import { collectMessagesFromGuild } from './guild';
import { detectConversationsWithOllama, generateTitleForConversation } from './ollama';

export async function collectUserConversations(
    guild: Guild,
    user: User
): Promise<Conversation[]> {
    // Step 1: Collect messages from the user
    const userMessages: MessageData[] = await collectMessagesFromGuild(guild, user);

    if (userMessages.length === 0) {
        return [];
    }

    // Step 2: Extract timestamps
    const timestamps = userMessages.map((msg) => msg.createdAt.toISOString());

    // Step 3: Send timestamps to AI to get conversation boundaries
    const conversationBoundaries = await detectConversationsWithOllama(timestamps);

    // Step 4: Construct Conversation objects
    const conversations: Conversation[] = [];

    for (const boundary of conversationBoundaries) {
        const startTime = new Date(boundary.startTime);
        const endTime = new Date(boundary.endTime);

        // Get messages within boundaries, including a 3-message buffer before and after
        const conversationMessages = await collectConversationMessages(
            guild,
            user,
            startTime,
            endTime,
            3 // Buffer size
        );

        // Step 5: Generate title for the conversation
        const summaryTitle = await generateTitleForConversation(conversationMessages);

        console.log(summaryTitle)
        
        conversations.push({
            startTime,
            endTime,
            messages: conversationMessages,
            summaryTitle,
        });
    }

    return conversations;
}

// Helper function to collect messages within boundaries with buffer
async function collectConversationMessages(
    guild: Guild,
    user: User,
    startTime: Date,
    endTime: Date,
    bufferSize: number
): Promise<MessageData[]> {
    const messages: MessageData[] = [];

    const channels = guild.channels.cache.filter(
        (channel) => channel.type === ChannelType.GuildText
    );

    for (const channel of channels.values()) {
        const textChannel = channel as TextChannel;

        // Permission Checks
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

            while (!fetchComplete) {
                const options = { limit: 100 } as { limit: number; before?: Snowflake };
                if (lastMessageId) {
                    options.before = lastMessageId;
                }

                const fetchedMessages = await textChannel.messages.fetch(options);

                if (fetchedMessages.size === 0) {
                    break;
                }

                for (const msg of fetchedMessages.values()) {
                    if (!msg.content || msg.author.bot) continue;

                    // Check if message is within the conversation time frame with buffer
                    const bufferStartTime = new Date(startTime.getTime() - bufferSize * 60 * 1000);
                    const bufferEndTime = new Date(endTime.getTime() + bufferSize * 60 * 1000);

                    if (msg.createdAt >= bufferStartTime && msg.createdAt <= bufferEndTime) {
                        messages.push({
                            content: msg.content,
                            createdAt: msg.createdAt,
                            authorId: msg.author.id,
                            authorUsername: msg.author.username,
                            channelId: msg.channel.id,
                            channelName: msg.channel.name,
                        });
                    }

                    if (msg.createdAt < bufferStartTime) {
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

    // Remove duplicates and sort messages
    const uniqueMessages = Array.from(
        new Map(messages.map((msg) => [msg.createdAt.getTime() + msg.authorId, msg])).values()
    );
    uniqueMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return uniqueMessages;
}
