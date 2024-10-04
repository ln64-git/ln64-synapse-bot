
import type { Conversation, MessageData } from '../types';
import { Guild, Snowflake, TextChannel, User } from 'discord.js';
import { collectMessagesFromGuild } from './guild-utils';
import pLimit from 'p-limit';

const MAX_CONVERSATIONS = 10; // Adjust as needed
const MAX_MESSAGES_PER_CONVERSATION = 50; // Adjust as needed
const CONCURRENCY_LIMIT = 5; // Adjust as needed

// Collect User Conversations with Context
export async function collectUserConversations(
    guild: Guild,
    user: User,
    days?: number
): Promise<Conversation[]> {
    let sinceDate: Date | undefined;
    if (days !== undefined && days !== null) {
        sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    }

    const userMessages: MessageData[] = await collectMessagesFromGuild(guild, user, sinceDate);

    if (userMessages.length === 0) {
        return [];
    }

    // Detect conversations based on time gaps
    const conversations = detectConversations(userMessages);

    // Limit the number of conversations
    const limitedConversations = conversations.slice(0, MAX_CONVERSATIONS);

    for (const conv of limitedConversations) {
        const channelId = conv.messages[0].channelId;
        const contextMessages = await fetchContextMessages(
            guild,
            channelId,
            new Date(conv.startTime.getTime() - 5 * 60 * 1000), // Expanding the window by 5 minutes earlier
            new Date(conv.endTime.getTime() + 5 * 60 * 1000)    // Expanding the window by 5 minutes later
        );

        // Ensure no duplicates and merge messages
        const uniqueMessages = contextMessages.filter(
            contextMsg => !conv.messages.some(msg => msg.createdAt.getTime() === contextMsg.createdAt.getTime())
        );

        conv.messages.push(...uniqueMessages);
        conv.messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()); // Sort by time
    }

    return limitedConversations;
}

// Detect Conversations Logic
export function detectConversations(
    messages: MessageData[],
    timeGapInMinutes: number = 30
): Conversation[] {
    if (messages.length === 0) {
        return [];
    }

    const sortedMessages = messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const conversations: Conversation[] = [];
    let currentConversationMessages: MessageData[] = [sortedMessages[0]];
    let conversationStartTime = sortedMessages[0].createdAt;
    let conversationEndTime = sortedMessages[0].createdAt;

    for (let i = 1; i < sortedMessages.length; i++) {
        const currentMessage = sortedMessages[i];
        const previousMessage = sortedMessages[i - 1];
        const timeDifference = currentMessage.createdAt.getTime() - previousMessage.createdAt.getTime();

        if (timeDifference <= timeGapInMinutes * 60 * 1000) {
            currentConversationMessages.push(currentMessage);
            conversationEndTime = currentMessage.createdAt;
        } else {
            conversations.push({
                startTime: conversationStartTime,
                endTime: conversationEndTime,
                messages: currentConversationMessages,
            });
            currentConversationMessages = [currentMessage];
            conversationStartTime = currentMessage.createdAt;
            conversationEndTime = currentMessage.createdAt;
        }
    }

    // Push last conversation
    conversations.push({
        startTime: conversationStartTime,
        endTime: conversationEndTime,
        messages: currentConversationMessages,
    });

    return conversations;
}

// Fetch Context Messages from the Channel within a Timeframe
export async function fetchContextMessages(
    guild: Guild,
    channelId: string,
    startTime: Date,
    endTime: Date
): Promise<MessageData[]> {
    const channel = guild.channels.cache.get(channelId) as TextChannel;
    if (!channel) throw new Error("Channel not found");

    const messages: MessageData[] = [];
    let lastMessageId: Snowflake | undefined;
    let fetchComplete = false;

    while (!fetchComplete) {
        const fetchedMessages = await channel.messages.fetch({
            limit: 100,
            before: lastMessageId,
        });

        if (fetchedMessages.size === 0) break;

        for (const msg of fetchedMessages.values()) {
            if (msg.createdAt >= startTime && msg.createdAt <= endTime) {
                // Attachments (e.g., images, files)
                const attachments = msg.attachments.map(att => att.url);

                // Embeds (e.g., GIFs, rich media, external links)
                const embeds = msg.embeds.map(embed => embed.url || embed.description || "Embed Content");

                const content = [
                    msg.content,
                    ...attachments,
                    ...embeds
                ].filter(Boolean).join('\n');

                messages.push({
                    content: content,
                    createdAt: msg.createdAt,
                    authorId: msg.author.id,
                    authorUsername: msg.author.username,
                    channelId: msg.channel.id,
                    channelName: msg.channel.name,
                });
            }
        }

        lastMessageId = fetchedMessages.last()?.id;
        fetchComplete = fetchedMessages.size < 100;
    }

    return messages;
}






