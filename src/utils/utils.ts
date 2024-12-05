import fs from "fs";
import path from "path";
import type { Conversation } from "../types";

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
    }));

    // Optionally merge with existing file data
    let existingConversations: {
        id: string;
        messages: { author: string; content: string }[];
        participants: string[];
    }[] = [];

    if (fs.existsSync(logFilePath)) {
        try {
            const fileContent = fs.readFileSync(logFilePath, "utf-8");
            existingConversations = JSON.parse(fileContent);
        } catch (error) {
            console.error(
                "Error reading or parsing existing conversations log file:",
                error,
            );
            // Handle the error, e.g., by initializing an empty array
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
