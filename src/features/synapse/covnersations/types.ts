import { Message } from "discord.js";

/**
 * Extended interface to represent a Discord message
 * that includes a field for embedding data.
 */
export interface DiscordMessageWithEmbedding extends Message<true> {
    /**
     * A numeric vector representing the embedding for this message’s textual content.
     */
    keywords?: string[];
    cleanContentEmbedding?: number[];
}

export type TrimmedMessage = {
    timestamp: number;
    server: string;
    channel: string;
    message: {
        content: string;
        author: string;
        attachments: string[];
        mentions: string[];
    };
};

export interface Thread {
    id: number;
    messageCount: number;
    messages: DiscordMessageWithEmbedding[];
    participants: string[];
    startTime: Date;
    lastActive: Date;
    keywords: string[];
    threadEmbedding?: number[];
}
