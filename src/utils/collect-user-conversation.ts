// src/utils/collect-user-conversations.ts

import { Guild, User } from 'discord.js';
import type { Conversation, MessageData } from '../types';
import { collectMessagesFromGuild } from './guild';
import { detectConversations, generateTitleForConversation } from './conversation';

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
    const userMessages: MessageData[] = await collectMessagesFromGuild(guild, user, sinceDate);

    if (userMessages.length === 0) {
        return [];
    }

    // Step 2: Detect conversations based on time gaps
    const conversations = detectConversations(userMessages);

    // Step 3: Generate titles for each conversation
    for (const conversation of conversations) {
        const summaryTitle = await generateTitleForConversation(conversation.messages);
        conversation.summaryTitle = summaryTitle;
    }

    return conversations;
}
