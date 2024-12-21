import { Message } from "discord.js";

export interface DiscordMessageWithEmbedding extends Message {
  messageData: Message[];
  cleanContentEmbedding?: number[];
}

export interface Conversation {
  id: number;
  messages: Message<true>[];
  participants: string[];
  startTime: Date;
  lastActive: Date;
  conversationEmbedding?: number[];
  keywords?: string[];
}

export type FiresideMessage = {
  displayName: string;
  messageContent?: string;
  attachments?: FiresideAttachment[];
  timestamp: string;
  embedding: number[] | null;
  id: string; // Add id property
  createdAt: Date; // Add createdAt property
  content: string; // Add content property
  member?: { displayName: string }; // Add member property
  author: { username: string }; // Add author property
  reference?: { messageId: string }; // Add reference property
  mentions: { users: { id: string }[] }; // Add mentions property
  guild?: { members: { cache: Map<string, { displayName: string }> } }; // Add guild property
};

export type FiresideAttachment = {
  url?: string;
  summary?: string;
  ocrText?: string;
};
