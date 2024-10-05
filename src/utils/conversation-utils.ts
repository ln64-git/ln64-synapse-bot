
import type { Conversation, MessageData } from '../types';
import { Guild, PermissionsBitField, Snowflake, TextChannel, User } from 'discord.js';
import { collectMessagesFromGuild, collectUserList } from './guild-utils';
import pLimit from 'p-limit';

const MAX_CONVERSATIONS = 10; // Adjust as needed

export async function collectUserConversations(
    guild: Guild,
    user: User,
    days?: number
): Promise<Conversation[]> {
    let sinceDate: Date | undefined;
    if (days !== undefined) {
        sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    }

    const userMessages: MessageData[] = await collectMessagesFromGuild(guild, user, sinceDate);

    if (userMessages.length === 0) return [];

    const conversations = detectConversations(userMessages);
    const limitedConversations = conversations.slice(0, MAX_CONVERSATIONS);

    // Fetch context messages for each conversation
    await Promise.all(limitedConversations.map(async (conv) => {
        const contextMessages = await fetchContextMessages(
            guild, conv.messages[0].channelId, new Date(conv.startTime.getTime() - 5 * 60 * 1000),
            new Date(conv.endTime.getTime() + 5 * 60 * 1000)
        );
        // Add unique context messages to the conversation
        const uniqueMessages = contextMessages.filter(ctxMsg =>
            !conv.messages.some(msg => msg.createdAt.getTime() === ctxMsg.createdAt.getTime())
        );
        conv.messages.push(...uniqueMessages);
        conv.messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    }));

    return limitedConversations;
}


export function detectConversations(
    messages: MessageData[],
    timeGapInMinutes: number = 30
): Conversation[] {
    if (messages.length === 0) return [];

    const sortedMessages = messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const conversations: Conversation[] = [];
    let currentConversation: MessageData[] = [sortedMessages[0]];

    for (let i = 1; i < sortedMessages.length; i++) {
        const currentMessage = sortedMessages[i];
        const previousMessage = sortedMessages[i - 1];

        if (currentMessage.createdAt.getTime() - previousMessage.createdAt.getTime() <= timeGapInMinutes * 60000) {
            currentConversation.push(currentMessage);
        } else {
            conversations.push({
                startTime: currentConversation[0].createdAt,
                endTime: currentConversation[currentConversation.length - 1].createdAt,
                messages: currentConversation,
            });
            currentConversation = [currentMessage];
        }
    }

    // Add the last conversation
    conversations.push({
        startTime: currentConversation[0].createdAt,
        endTime: currentConversation[currentConversation.length - 1].createdAt,
        messages: currentConversation
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

export async function collectUserMentions(
    guild: Guild,
    user: { userId: string; username: string; },
    days?: number
): Promise<MessageData[]> {
    const mentions: MessageData[] = [];
    let collectedMentionCount = 0;
    const MAX_MENTIONS = 500; // Adjust as needed
    const sinceDate = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;

    // Fetch user list to get possible aliases (usernames and nicknames)
    const userList = await collectUserList(guild);
    const userAliases = userList
        .filter(u => u.userId === user.userId)
        .map(u => u.username.toLowerCase())
        .concat(user.username.toLowerCase());

    const channels = guild.channels.cache.filter(
        (channel) => channel.type === 0 // Guild Text Channels
    );

    const limit = pLimit(5); // Adjust concurrency as needed

    await Promise.all(
        channels.map((channel) =>
            limit(async () => {
                if (collectedMentionCount >= MAX_MENTIONS) return;

                const textChannel = channel as TextChannel;
                const permissions = textChannel.permissionsFor(guild.members.me!);
                if (
                    !permissions?.has(PermissionsBitField.Flags.ViewChannel) ||
                    !permissions.has(PermissionsBitField.Flags.ReadMessageHistory)
                ) {
                    console.error(`Skipping channel ${textChannel.name}: Missing permissions`);
                    return;
                }

                try {
                    let lastMessageId: Snowflake | undefined;
                    let fetchComplete = false;

                    while (!fetchComplete && collectedMentionCount < MAX_MENTIONS) {
                        const options = { limit: 100 } as { limit: number; before?: Snowflake };
                        if (lastMessageId) {
                            options.before = lastMessageId;
                        }

                        const fetchedMessages = await textChannel.messages.fetch(options);
                        if (fetchedMessages.size === 0) break;

                        for (const msg of fetchedMessages.values()) {
                            // Skip if the message author is the target user
                            if (msg.author.id === user.userId) continue;

                            // Check for direct mentions
                            const hasDirectMention = msg.mentions.users.has(user.userId);

                            // Check for indirect mentions by username or nickname
                            const messageContentLower = msg.content.toLowerCase();
                            const hasIndirectMention = userAliases.some(alias =>
                                messageContentLower.includes(alias)
                            );

                            if (hasDirectMention || hasIndirectMention) {
                                // Check if the message is within the time frame
                                if (sinceDate && msg.createdAt < sinceDate) {
                                    fetchComplete = true;
                                    break;
                                }

                                mentions.push({
                                    content: msg.content,
                                    createdAt: msg.createdAt,
                                    authorId: msg.author.id,
                                    authorUsername: msg.author.username,
                                    channelId: msg.channel.id,
                                    channelName: msg.channel.name,
                                });

                                collectedMentionCount++;
                                if (collectedMentionCount >= MAX_MENTIONS) {
                                    fetchComplete = true;
                                    break;
                                }
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
            })
        )
    );

    console.log(`Total mentions collected for user ${user.username}: ${mentions.length}`);
    return mentions;
}