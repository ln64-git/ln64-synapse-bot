import { Message, TextChannel } from "discord.js";
import { Conversation } from "../types";

export async function assembleConversations(
    messages: Message[],
    timeThreshold: number = 10 * 60 * 1000, // 10 minutes in milliseconds
    contextRadius: number = 5, // Number of messages before and after
): Promise<Conversation[]> {
    const conversations: Conversation[] = [];

    // Sort messages by creation time
    messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    let currentConversation: Conversation | null = null;

    for (const message of messages) {
        const channel = message.channel as TextChannel;

        // Fetch context messages
        const beforeMessages = await channel.messages.fetch({
            limit: contextRadius,
            before: message.id,
        });
        const afterMessages = await channel.messages.fetch({
            limit: contextRadius,
            after: message.id,
        });

        // Combine the messages
        const contextMessages = [
            ...beforeMessages.values(),
            message,
            ...afterMessages.values(),
        ];

        // Sort messages by creation time
        contextMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        for (const msg of contextMessages) {
            if (currentConversation) {
                const lastMessage =
                    currentConversation
                        .messages[currentConversation.messages.length - 1];
                if (
                    msg.createdTimestamp - lastMessage.createdTimestamp <=
                        timeThreshold
                ) {
                    currentConversation.messages.push(msg);
                    currentConversation.endTime = msg.createdAt;
                } else {
                    conversations.push(currentConversation);
                    currentConversation = {
                        startTime: msg.createdAt,
                        endTime: msg.createdAt,
                        messages: [msg],
                    };
                }
            } else {
                currentConversation = {
                    startTime: msg.createdAt,
                    endTime: msg.createdAt,
                    messages: [msg],
                };
            }
        }
    }

    if (currentConversation) {
        conversations.push(currentConversation);
    }

    return conversations;
}
