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

/**
 * Converts a Discord message to a trimmed format, excluding sensitive or unnecessary data.
 * @param message - The Discord message to trim.
 * @returns A trimmed message object.
 */
export function convertToTrimmedMessage(message: Message<true>) {
    return {
        id: message.id,
        timestamp: message.createdTimestamp,
        server: message.guild?.name,
        channel: message.channel.name,
        message: {
            content: message.content,
            author: message.author.username,
            attachments: message.attachments.map((att) => att.url),
            mentions: message.mentions.users.map((user) => user.username),
        },
    };
}

export function getDeletedMessagesByUser(author: string): TrimmedMessage[] {
    const logsPath = path.join(__dirname, "../../logs/");
    function collectMessages(dir: string) {
        const entries = fs.readdirSync(dir);
        const messages: TrimmedMessage[] = [];
        for (const entrie in entries) {
            const filePath = path.join(dir, entrie);
            const stats = fs.statSync(filePath);
            if (stats.isDirectory()) {
                messages.push(...collectMessages(filePath));
            } else if (filePath.startsWith("deletedMessages")) {
                const fileContent = fs.readFileSync(filePath, "utf-8");
                const parsedData = JSON.parse(fileContent) as TrimmedMessage[];
                messages.push(...parsedData);
            }
        }
        return messages;
    }
    const allMessages = collectMessages(logsPath);
    const filteredMessages = allMessages.filter((msg) =>
        msg.message.author == author
    );
    return filteredMessages;
}

export function getDeletedMessagesByUser2(author: string): TrimmedMessage[] {
    const logsPath = path.join(__dirname, "../../logs");

    // Helper function to collect messages recursively
    function collectMessages(dir: string): TrimmedMessage[] {
        const entries = fs.readdirSync(dir);
        const messages: TrimmedMessage[] = [];

        for (const entry of entries) {
            const filePath = path.join(dir, entry);
            const stats = fs.statSync(filePath);

            if (stats.isDirectory()) {
                // Recursively process subdirectories
                messages.push(...collectMessages(filePath));
            } else if (
                path.basename(filePath).startsWith("deletedMessages") &&
                filePath.endsWith(".json")
            ) {
                try {
                    const fileContent = fs.readFileSync(filePath, "utf-8");

                    // Check for incomplete JSON data
                    if (!fileContent.trim()) {
                        console.warn(
                            `Empty or incomplete JSON file: ${filePath}`,
                        );
                        continue;
                    }

                    const parsedData = JSON.parse(fileContent);

                    if (Array.isArray(parsedData)) {
                        messages.push(...(parsedData as TrimmedMessage[]));
                    } else {
                        console.warn(
                            `Unexpected data format in file: ${filePath}`,
                        );
                    }
                } catch (error) {
                    if (error instanceof SyntaxError) {
                        console.error(
                            `JSON SyntaxError in file: ${filePath}. It might be corrupted.`,
                            error.message,
                        );
                    } else {
                        console.error(
                            `Failed to process file: ${filePath}`,
                            error,
                        );
                    }
                }
            }
        }

        return messages;
    }

    try {
        const allMessages = collectMessages(logsPath);
        return allMessages.filter((msg) => msg.message.author === author);
    } catch (error) {
        console.error("Error collecting messages:", error);
        return [];
    }
}
