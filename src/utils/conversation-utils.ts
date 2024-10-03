// src/utils/conversation-utils.ts

import type { Conversation, MessageData } from '../types';
import { Guild, User } from 'discord.js';
import { collectMessagesFromGuild } from './guild-utils';
import pLimit from 'p-limit';
import { generateSummaryWithAgent } from './agent-utils';

const MAX_CONVERSATIONS = 10; // Adjust as needed
const MAX_MESSAGES_PER_CONVERSATION = 50; // Adjust as needed
const CONCURRENCY_LIMIT = 5; // Adjust as needed

const titleCache = new Map<string, string>();

export async function collectUserConversations(
    guild: Guild,
    user: User,
    days?: number
): Promise<Conversation[]> {
    // Calculate the 'sinceDate' if 'days' is provided
    let sinceDate: Date | undefined;
    if (days !== undefined && days !== null) {
        sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    }

    // Step 1: Collect messages from the user, pass 'sinceDate'
    const userMessages: MessageData[] = await collectMessagesFromGuild(
        guild,
        user,
        sinceDate
    );

    if (userMessages.length === 0) {
        return [];
    }

    // Step 2: Detect conversations based on time gaps
    const conversations = detectConversations(userMessages);

    // Limit the number of conversations
    const limitedConversations = conversations.slice(0, MAX_CONVERSATIONS);

    // Step 3: Generate titles for each conversation with concurrency limit
    const limit = pLimit(CONCURRENCY_LIMIT);

    await Promise.all(
        limitedConversations.map((conversation) =>
            limit(async () => {
                const summaryTitle = await generateTitleForConversation(conversation.messages);
                console.log("Summmary Title:")
                console.log(summaryTitle)
                conversation.summaryTitle = summaryTitle;
            })
        )
    );

    return limitedConversations;
}

export function detectConversations(
    messages: MessageData[],
    timeGapInMinutes: number = 5
): Conversation[] {
    if (messages.length === 0) {
        return [];
    }

    // Sort messages by creation time
    const sortedMessages = messages.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );

    const conversations: Conversation[] = [];
    let currentConversationMessages: MessageData[] = [sortedMessages[0]];
    let conversationStartTime = sortedMessages[0].createdAt;
    let conversationEndTime = sortedMessages[0].createdAt;

    for (let i = 1; i < sortedMessages.length; i++) {
        const currentMessage = sortedMessages[i];
        const previousMessage = sortedMessages[i - 1];
        const timeDifference =
            currentMessage.createdAt.getTime() - previousMessage.createdAt.getTime();

        if (timeDifference <= timeGapInMinutes * 60 * 1000) {
            // Within the time gap, same conversation
            currentConversationMessages.push(currentMessage);
            conversationEndTime = currentMessage.createdAt;
        } else {
            // Time gap exceeded, start a new conversation
            conversations.push({
                startTime: conversationStartTime,
                endTime: conversationEndTime,
                messages: currentConversationMessages,
                summaryTitle: '', // We'll generate this later
            });

            // Start new conversation
            currentConversationMessages = [currentMessage];
            conversationStartTime = currentMessage.createdAt;
            conversationEndTime = currentMessage.createdAt;
        }
    }

    // Add the last conversation
    conversations.push({
        startTime: conversationStartTime,
        endTime: conversationEndTime,
        messages: currentConversationMessages,
        summaryTitle: '', // We'll generate this later
    });

    return conversations;
}

export async function generateTitleForConversation(
    messages: MessageData[]
): Promise<string> {
    const convHash = hashMessages(messages);
    if (titleCache.has(convHash)) {
        return titleCache.get(convHash)!;
    }

    const convText = messages
        .slice(0, MAX_MESSAGES_PER_CONVERSATION)
        .map((msg) => `${msg.authorUsername}: ${msg.content}`)
        .join('\n');

    const prompt = `You are an AI language model that generates concise titles for conversations.

Given the following conversation, provide a short title that summarizes the main topic.

Conversation:
${convText}

Title:`;

    try {
        const title = await generateSummaryWithAgent(prompt);
        titleCache.set(convHash, title.trim());
        return title.trim();
    } catch (error) {
        console.error('Error generating title for conversation:', error);
        throw new Error('Failed to generate title using Ollama.');
    }
}

function hashMessages(messages: MessageData[]): string {
    // Implement a hash function, e.g., using a hashing library
    const content = messages.map((msg) => msg.content).join('|');
    return content; // For simplicity; replace with actual hash in production
}
