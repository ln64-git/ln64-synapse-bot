// src/utils/conversation-utils.ts

import type { Conversation, MessageData } from '../types';
import { generateSummaryWithOllama } from './ollama';

export function detectConversations(
    messages: MessageData[],
    timeGapInMinutes: number = 5
): Conversation[] {
    if (messages.length === 0) {
        return [];
    }

    // Sort messages by creation time
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

export async function generateTitleForConversation(messages: MessageData[]): Promise<string> {
    const convText = messages
        .map((msg) => `${msg.authorUsername}: ${msg.content}`)
        .join('\n');

    const prompt = `You are an AI language model that generates concise titles for conversations.

Given the following conversation, provide a short title that summarizes the main topic.

Conversation:
${convText}

Title:`;

    try {
        const title = await generateSummaryWithOllama(prompt);
        return title.trim();
    } catch (error) {
        console.error('Error generating title for conversation:', error);
        throw new Error('Failed to generate title using Ollama.');
    }
}
