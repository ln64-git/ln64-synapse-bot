import fs from "fs";
import path from "path";
import type { Conversation, TrimmedMessage } from "../types/types";
import type { Message } from "discord.js";

export async function saveAllConversationsToFile(
    conversations: Conversation[],
) {
    const logFilePath = path.join(__dirname, "../../logs/conversations.json");
    const cleanedConversations = conversations.map((conversation) => ({
        id: conversation.id.toString(),
        messages: conversation.messages.map((msg) => ({
            author: msg.member?.displayName || msg.author.username,
            content: msg.content,
        })),
        participants: conversation.participants,
        keywords: conversation.keywords || [], // Include keywords in the output
    }));

    // Optionally merge with existing file data
    let existingConversations: {
        id: string;
        messages: { author: string; content: string }[];
        participants: string[];
        keywords?: string[];
    }[] = [];

    if (fs.existsSync(logFilePath)) {
        try {
            const fileContent = fs.readFileSync(logFilePath, "utf-8");
            if (fileContent.trim()) {
                existingConversations = JSON.parse(fileContent);
            }
        } catch (error) {
            console.error(
                "Error reading or parsing existing conversations log file:",
                error,
            );
            existingConversations = [];
        }
    }

    // Merge old and new conversations (avoid duplicates if needed)
    const allConversations = [
        ...existingConversations,
        ...cleanedConversations,
    ];

    // Sort or manipulate if you want
    allConversations.sort((a, b) => b.messages.length - a.messages.length);

    fs.writeFileSync(
        logFilePath,
        JSON.stringify(allConversations, null, 2),
    );

    console.log(`Saved ${conversations.length} conversations to log file.`);
}

export function convertToTrimmedMessage(message: Message): TrimmedMessage {
    return {
        timestamp: new Date(message.createdTimestamp).toISOString(),
        server: message.guild?.name || "Direct Message",
        channel: message.channel.isTextBased() && "name" in message.channel &&
                message.channel.name
            ? message.channel.name
            : "Unknown Channel",
        message: {
            content: message.content || "[No Content]",
            author: `${message.author.displayName}`,
            attachments: Array.from(message.attachments.values()).map((a) =>
                a.url
            ),
            mentions: message.mentions.users.map((u) => u.username),
        },
    };
}
