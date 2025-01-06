import { Message } from "discord.js";

/**
 * Extended interface to represent a Discord message
 * that includes a field for embedding data.
 */
export interface DiscordMessageWithEmbedding extends Message<true> {
  /**
   * A numeric vector representing the embedding for this message’s textual content.
   */
  cleanContentEmbedding?: number[];
}

export interface Conversation {
  id: number;
  messageCount: number;
  messages: DiscordMessageWithEmbedding[]; // updated to store extended messages
  participants: string[];
  startTime: Date;
  lastActive: Date;
  conversationEmbedding?: number[];
  keywords?: string[];
  keywordEmbedding?: number[];
}

export type TrimmedMessage = {
  timestamp: string;
  server: string;
  channel: string;
  message: {
    content: string;
    author: string;
    attachments: string[];
    mentions: string[];
  };
};
