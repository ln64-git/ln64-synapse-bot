import { Guild, TextChannel, Message, Snowflake, PermissionsBitField, User } from 'discord.js';
import Logger from '@ptkdev/logger';
import pLimit from 'p-limit';
import { Conversation } from '../types';
import { collectMessagesFromGuild, collectUserList } from './guild-utils';

export async function collectUserConversations(
    guild: Guild,
    user: User,
    days?: number
): Promise<Conversation[]> {
    let sinceDate: Date | undefined;
    if (days !== undefined) {
        sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    }

    const userMessages: Message[] = await collectMessagesFromGuild(guild, user, sinceDate);

    // Detect conversations and automatically fetch context messages
    const conversations = await detectConversations(userMessages, guild);

    return conversations;
}

export async function detectConversations(
    messages: Message[],
    guild: Guild,
    timeGapInMinutes: number = 30,
    contextWindowInMinutes: number = 5
): Promise<Conversation[]> {
    if (messages.length === 0) return [];
    const logger = new Logger();

    logger.info(`Starting conversation detection with ${messages.length} messages...`);
    const totalStart = performance.now();

    // Sort messages by timestamp
    const sortedMessages = messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const conversations: Conversation[] = [];
    let currentConversation: Message[] = [sortedMessages[0]];

    // Group messages into conversations based on time gaps
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

    if (currentConversation.length > 0) {
        conversations.push({
            startTime: currentConversation[0].createdAt,
            endTime: currentConversation[currentConversation.length - 1].createdAt,
            messages: currentConversation,
        });
    }

    // Step 2: Batch fetch context messages for all conversations at once
    logger.info(`Fetching context messages in batch for all conversations...`);
    const contextMessages = await fetchContextMessagesInBatch(guild, conversations, contextWindowInMinutes);

    // Step 3: Append context messages to the conversations
    appendContextMessagesToConversations(conversations, contextMessages);

    // End timing and log
    const totalEnd = performance.now();
    const totalDurationSeconds = ((totalEnd - totalStart) / 1000).toFixed(2);
    logger.info(`Finished detecting conversations in ${totalDurationSeconds} seconds.`);

    return conversations;
}

async function fetchContextMessagesInBatch(
    guild: Guild,
    conversations: Conversation[],
    contextWindowInMinutes: number
): Promise<Message[]> {
    const logger = new Logger();
    const allChannels = new Set(conversations.map(conv => conv.messages[0].channelId));
    const contextMessages: Message[] = [];

    await Promise.all(
        Array.from(allChannels).map(async (channelId) => {
            const channel = guild.channels.cache.get(channelId) as TextChannel;
            if (!channel) return;

            const contextStart = new Date(Math.min(...conversations.map(conv => conv.startTime.getTime())) - contextWindowInMinutes * 60 * 1000);
            const contextEnd = new Date(Math.max(...conversations.map(conv => conv.endTime.getTime())) + contextWindowInMinutes * 60 * 1000);

            try {
                const fetchedMessages = await fetchMessagesInRange(channel, contextStart, contextEnd);
                contextMessages.push(...fetchedMessages);
            } catch (error: any) {
                logger.error(`Error fetching context messages for channel ${channelId}: ${error.message}`);
            }
        })
    );

    return contextMessages;
}

async function fetchMessagesInRange(
    channel: TextChannel,
    startTime: Date,
    endTime: Date
): Promise<Message[]> {
    const messages: Message[] = [];
    let lastMessageId: Snowflake | undefined;
    let fetchComplete = false;

    while (!fetchComplete) {
        const fetchedMessages = await channel.messages.fetch({
            limit: 100,
            before: lastMessageId,
        });

        if (fetchedMessages.size === 0) break;

        fetchedMessages.forEach(msg => {
            if (msg.createdAt >= startTime && msg.createdAt <= endTime) {
                messages.push(msg);
            }
        });

        lastMessageId = fetchedMessages.last()?.id;
        fetchComplete = fetchedMessages.size < 100;
    }

    return messages;
}

function appendContextMessagesToConversations(conversations: Conversation[], contextMessages: Message[]): void {
    conversations.forEach(conv => {
        const relevantContext = contextMessages.filter(ctxMsg =>
            ctxMsg.createdAt >= new Date(conv.startTime.getTime() - 30 * 60 * 1000) &&
            ctxMsg.createdAt <= new Date(conv.endTime.getTime() + 30 * 60 * 1000)
        );

        const uniqueMessages = relevantContext.filter(ctxMsg =>
            !conv.messages.some(msg => msg.createdAt.getTime() === ctxMsg.createdAt.getTime())
        );

        conv.messages.push(...uniqueMessages);
        conv.messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    });
}

export async function collectUserMentions(
    guild: Guild,
    user: { userId: string; username: string },
    days?: number
): Promise<Message[]> {
    const mentions: Message[] = [];
    let collectedMentionCount = 0;
    const MAX_MENTIONS = 500; // Adjust as needed
    const sinceDate = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;

    // Fetch user list to get possible aliases (usernames and nicknames)
    const userList = await collectUserList(guild); // Assuming this returns GuildMembers or Users
    const userAliases = userList
        .filter(u => u.user.id === user.userId)
        .map(u => u.user.username.toLowerCase())
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

                                mentions.push(msg); // Push the full Message object

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
