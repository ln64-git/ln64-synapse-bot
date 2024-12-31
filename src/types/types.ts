import { Message } from "discord.js";

export interface DiscordMessageWithEmbedding extends Message {
  messageData: Message[];
  cleanContentEmbedding?: number[];
}

export interface Conversation {
  id: number;
  messageCount: number;
  messages: Message<true>[];
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
