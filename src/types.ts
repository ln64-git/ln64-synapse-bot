import { Message } from "discord.js";

export interface DiscordMessageWithEmbedding extends Message {
  messageData: Message[];
  cleanContentEmbedding?: number[];
}

export interface Conversation {
  id: number;
  messages: FiresideMessage[];
  participants: string[];
  lastActive: Date;
  conversationEmbedding?: number[];
  embeddingSum?: number[];
}

export type FiresideMessage = {
  displayName: string;
  messageContent?: string;
  attachments?: FiresideAttachment[];
  timestamp: string;
  embedding: number[];
};

export type FiresideAttachment = {
  url?: string;
  summary?: string;
  ocrText?: string;
};
