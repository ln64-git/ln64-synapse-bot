import fs from "fs";
import path from "path";
import type { Conversation } from "../types";

export async function saveConversationToFile(conversation: Conversation) {
    const logFilePath = path.join(
        __dirname,
        "../../logs/conversations.json",
    );
    let existingConversations: {
        id: string;
        messages: { author: string; content: string }[];
        participants: string[];
    }[] = [];

    try {
        if (fs.existsSync(logFilePath)) {
            const fileContent = fs.readFileSync(logFilePath, "utf-8");
            existingConversations = JSON.parse(fileContent);
        }
    } catch (error) {
        console.error("Error reading existing conversations log file:", error);
    }

    // Extract clean content and authors from the conversation
    const cleanConversation = {
        id: conversation.id.toString(),
        messages: conversation.messages.map((msg) => ({
            author: msg.member?.displayName || msg.author.username,
            content: msg.content,
        })),
        participants: conversation.participants,
    };

    // Check if the conversation already exists, and update it if found
    const existingIndex = existingConversations.findIndex(
        (conv) => conv.id === cleanConversation.id,
    );

    if (existingIndex !== -1) {
        // Update the existing conversation
        existingConversations[existingIndex] = cleanConversation;
    } else {
        // Add the new conversation to the beginning of the array
        existingConversations.unshift(cleanConversation);
    }

    // Ensure that conversations are ordered with the most recent at the front
    existingConversations.sort((a, b) => {
        const aTimestamp = new Date(
            a.messages[a.messages.length - 1]?.content ?? 0,
        ).getTime();
        const bTimestamp = new Date(
            b.messages[b.messages.length - 1]?.content ?? 0,
        ).getTime();
        return bTimestamp - aTimestamp;
    });

    try {
        fs.writeFileSync(
            logFilePath,
            JSON.stringify(existingConversations, null, 2),
        );
        console.log(`Saved conversation ${conversation.id} to log file.`);
    } catch (error) {
        console.error("Error writing conversation to log file:", error);
    }
}

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
        const fileContent = fs.readFileSync(logFilePath, "utf-8");
        existingConversations = JSON.parse(fileContent);
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
