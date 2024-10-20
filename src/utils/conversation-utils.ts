import { Guild, Message, TextChannel } from "discord.js";
import Logger from "@ptkdev/logger";
import { Conversation } from "../types";
import { fetchMessagesFromGuild } from "../discord/guild-utils";

export async function assembleConversations(
    messages: Message[],
    guild: Guild,
    timeGapInMinutes: number = 30,
    contextWindowInMinutes: number = 5,
): Promise<Conversation[]> {
    if (messages.length === 0) return [];
    const logger = new Logger();

    logger.info(
        `Starting conversation detection with ${messages.length} messages...`,
    );
    const totalStart = performance.now();

    // Sort messages by timestamp
    messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Group messages into conversations
    const conversations: Conversation[] = [];
    let currentConversation: Message[] = [messages[0]];

    for (let i = 1; i < messages.length; i++) {
        const currentMessage = messages[i];
        const previousMessage = messages[i - 1];

        if (
            currentMessage.createdAt.getTime() -
                    previousMessage.createdAt.getTime() <=
                timeGapInMinutes * 60000
        ) {
            currentConversation.push(currentMessage);
        } else {
            conversations.push(createConversation(currentConversation));
            currentConversation = [currentMessage];
        }
    }

    if (currentConversation.length > 0) {
        conversations.push(createConversation(currentConversation));
    }

    // Fetch context messages in batch for all conversations
    logger.info(`Fetching context messages in batch for all conversations...`);
    const contextMessages = await fetchContextMessages(
        guild,
        conversations,
        contextWindowInMinutes,
        logger,
    );

    // Append context messages to the conversations
    appendContextMessages(conversations, contextMessages);

    const totalEnd = performance.now();
    const totalDurationSeconds = ((totalEnd - totalStart) / 1000).toFixed(2);
    logger.info(
        `Finished detecting conversations in ${totalDurationSeconds} seconds.`,
    );

    return conversations;
}

function createConversation(messages: Message[]): Conversation {
    return {
        startTime: messages[0].createdAt,
        endTime: messages[messages.length - 1].createdAt,
        messages: messages,
    };
}

async function fetchContextMessages(
    guild: Guild,
    conversations: Conversation[],
    contextWindowInMinutes: number,
    logger: Logger,
): Promise<Message[]> {
    const allChannels = new Set(
        conversations.map((conv) => conv.messages[0].channelId),
    );
    const contextMessages: Message[] = [];

    await Promise.all(
        Array.from(allChannels).map(async (channelId) => {
            const channel = guild.channels.cache.get(channelId) as TextChannel;
            if (!channel) return;

            const contextStart = new Date(
                Math.min(
                    ...conversations.map((conv) => conv.startTime.getTime()),
                ) - contextWindowInMinutes * 60 * 1000,
            );
            const contextEnd = new Date(
                Math.max(
                    ...conversations.map((conv) => conv.endTime.getTime()),
                ) + contextWindowInMinutes * 60 * 1000,
            );

            try {
                const fetchedMessages = await fetchMessagesFromGuild(
                    guild,
                    contextStart,
                    (msg) => msg.createdAt <= contextEnd,
                );
                contextMessages.push(...fetchedMessages);
            } catch (error: any) {
                logger.error(
                    `Error fetching context messages for channel ${channelId}: ${error.message}`,
                );
            }
        }),
    );

    return contextMessages;
}

function appendContextMessages(
    conversations: Conversation[],
    contextMessages: Message[],
): void {
    conversations.forEach((conv) => {
        const relevantContext = contextMessages.filter(
            (ctxMsg) =>
                ctxMsg.createdAt >=
                    new Date(conv.startTime.getTime() - 30 * 60 * 1000) &&
                ctxMsg.createdAt <=
                    new Date(conv.endTime.getTime() + 30 * 60 * 1000),
        );

        const uniqueMessages = relevantContext.filter(
            (ctxMsg) =>
                !conv.messages.some((msg) =>
                    msg.createdAt.getTime() === ctxMsg.createdAt.getTime()
                ),
        );

        conv.messages.push(...uniqueMessages);
        conv.messages.sort((a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime()
        );
    });
}
