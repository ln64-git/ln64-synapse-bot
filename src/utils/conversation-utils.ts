import { Guild, TextChannel, Message, Snowflake, PermissionsBitField, User, GuildMember, ChannelType } from 'discord.js';
import Logger from '@ptkdev/logger';
import { Conversation } from '../types';
import { fetchMessagesFromGuild } from './guild-utils';


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

export async function collectUserConversations(
    guild: Guild,
    user: GuildMember,
    days?: number
): Promise<Message[]> {
    const sinceDate = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;

    const userMessages = await fetchMessagesFromGuild(
        guild,
        sinceDate,
        msg => msg.author.id === user.id,  // Filter by messages from the user
    );

    return userMessages;
}

// Collect mentions of a user
export async function collectUserMentions(
    guild: Guild,
    user: GuildMember,
    days?: number
): Promise<Message[]> {
    if (!user || !user.user) {
        throw new Error('Invalid user object');
    }

    const sinceDate = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;

    // Create aliases using the display name and username in lowercase
    const aliases = [user.displayName.toLowerCase(), user.user.username?.toLowerCase() || ''];

    // I need to find a better way to find people's nicknames
    // Log the aliases for debugging
    console.log('Aliases:', aliases);

    // Check if we have a valid username before proceeding
    if (!user.user.username) {
        console.error(`No valid username for the user: ${user.displayName}`);
        return [];
    }

    // Fetch mentions of the user based on the display name and username
    const mentions = await fetchMessagesFromGuild(
        guild,
        sinceDate,
        msg => {
            const contentLower = msg.content.toLowerCase();
            const hasDirectMention = msg.mentions.users.has(user.id);
            const hasIndirectMention = aliases.some(alias => contentLower.includes(alias));
            return hasDirectMention || hasIndirectMention;
        }
    );

    return mentions;
}
