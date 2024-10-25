// src/types.ts
import { Message } from "discord.js";
import { D } from "ollama/dist/shared/ollama.51f6cea9";

export interface Conversation {
    messages: Message[];
    timestamp: number;
}

export interface ProcessedMessage {
    id: string;
    author: string;
    timestamp: number;
    channelId: string;
    textContent: string; // Cleaned text content
    links: string[]; // URLs extracted from the text
    attachments: AttachmentData[]; // Details about attachments
}

export interface AttachmentData {
    id: string;
    url: string;
    contentType: string; // e.g., 'image/png', 'video/mp4'
    proxyURL: string;
    size: number;
    filename: string;
}

export interface PineconeVector {
    id: string;
    values: number[];
    metadata?: {
        [key: string]: any;
    };
}
