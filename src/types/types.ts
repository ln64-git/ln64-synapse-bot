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

export type VoiceActivity = {
  start: number; // Timestamp in milliseconds
  duration: number; // Duration in milliseconds
};

export class Interaction {
  constructor(
    public content: string,
    public timestamp: number,
    public type: "mention" | "reply" | "other",
    public sender: string,
    public receiver: string,
  ) {}
}
