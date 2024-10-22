import { Message, TextChannel } from "discord.js";
import { Conversation } from "../types";
import {
    getMessagesAfterMessageId,
    getMessagesBeforeMessageId,
} from "../database/db";

export async function assembleConversations(
    messages: Message[],
    timeThreshold: number = 10 * 60 * 1000, // 10 minutes in milliseconds
    contextRadius: number = 5, // Number of messages before and after
): Promise<Conversation[]> {
    const conversations: Conversation[] = [];

    for (const message of messages) {
        let channel = message.channel as TextChannel;

        if (!channel || !(channel instanceof TextChannel)) {
            console.error(
                `Invalid channel or not a text channel for message ID ${message.id}.`,
            );
            continue;
        }

        // Fetch context messages from the database
        const beforeMessages = await getMessagesBeforeMessageId(
            channel.id,
            message.id,
            contextRadius,
        );
        const afterMessages = await getMessagesAfterMessageId(
            channel.id,
            message.id,
            contextRadius,
        );

        const contextMessages = [
            ...beforeMessages,
            message,
            ...afterMessages,
        ];

        conversations.push({
            messages: contextMessages,
            timestamp: message.createdTimestamp,
        });
    }

    return conversations;
}
