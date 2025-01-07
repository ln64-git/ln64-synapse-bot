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
// types/types.ts

export interface Conversation {
  id: number;
  messageCount: number;
  messages: DiscordMessageWithEmbedding[];
  participants: string[];
  startTime: Date;
  lastActive: Date;
  keywords: string[];
  conversationEmbedding?: number[];
}

export interface DiscordMessageWithEmbedding extends Message<true> {
  cleanContentEmbedding?: number[];
}

export interface Topic {
  id: number;
  messageCount: number;
  threads: Thread[];
  participants: string[];
  startTime: Date;
  lastActive: Date;
  keywords: string[];
  conversationEmbedding?: number[];
}

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
