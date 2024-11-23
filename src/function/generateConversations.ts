// conversationManager.ts

import type { Guild, Message } from "discord.js";
import { getFiresideMessages } from "../lib/discord/discord.ts";
import type { Conversation } from "../types.ts";
import * as fs from "fs";
import pLimit from "p-limit";

export class ConversationManager {
  private conversations: Conversation[] = [];
  private messageIdToConversationId: { [key: string]: number } = {};
  private conversationIdCounter = 0;
  private timeThreshold = 5 * 60 * 1000; // 5 minutes
  private similarityThreshold = 0.45; // Adjusted threshold

  constructor() {}

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) {
      console.warn(
        "Vectors have different lengths or are empty. Returning 0 similarity.",
      );
      return 0;
    }

    const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
    if (magnitudeA === 0 || magnitudeB === 0) {
      console.warn(
        "One of the vectors has zero magnitude. Returning 0 similarity.",
      );
      return 0;
    }
    return dotProduct / (magnitudeA * magnitudeB);
  }

  public async addMessageToConversations(
    message: Message<true>,
    embedding: number[] | null,
  ): Promise<void> {
    const displayName = message.member?.displayName || message.author.username;
    const referencedMessageId = message.reference?.messageId || null;
    let assigned = false;

    if (referencedMessageId) {
      const conversationId =
        this.messageIdToConversationId[referencedMessageId];
      if (conversationId !== undefined) {
        const conv = this.conversations.find((c) => c.id === conversationId)!;
        conv.messages.push(message);
        if (!conv.participants.includes(displayName)) {
          conv.participants.push(displayName);
        }
        conv.lastActive = message.createdAt;
        this.messageIdToConversationId[message.id] = conversationId;
        assigned = true;
      }
    }

    if (!assigned && message.mentions.users.size > 0) {
      const mentionDisplayNames = message.mentions.users.map((user) => {
        const member = message.guild?.members.cache.get(user.id);
        return member?.displayName || user.username;
      });

      for (const conv of this.conversations) {
        const participantSet = new Set(conv.participants);
        const mentionsSet = new Set(mentionDisplayNames);
        const intersection = new Set(
          [...participantSet].filter((x) => mentionsSet.has(x)),
        );
        if (intersection.size > 0) {
          conv.messages.push(message);
          if (!conv.participants.includes(displayName)) {
            conv.participants.push(displayName);
          }
          conv.lastActive = message.createdAt;
          this.messageIdToConversationId[message.id] = conv.id;
          assigned = true;
          break;
        }
      }
    }

    if (!assigned && embedding) {
      for (const conv of this.conversations) {
        // Add this check to ensure conv.conversationEmbedding is defined
        if (!conv.conversationEmbedding) {
          continue; // Skip this conversation if it doesn't have an embedding
        }

        const similarity = this.cosineSimilarity(
          embedding,
          conv.conversationEmbedding,
        );

        if (similarity > this.similarityThreshold) {
          conv.messages.push(message);
          if (!conv.participants.includes(displayName)) {
            conv.participants.push(displayName);
          }
          conv.lastActive = message.createdAt;
          this.messageIdToConversationId[message.id] = conv.id;
          assigned = true;
          break;
        }
      }
    }

    if (!assigned) {
      for (const conv of this.conversations) {
        const timeDiff = Math.abs(
          conv.lastActive.getTime() - message.createdAt.getTime(),
        );
        const withinTime = timeDiff < this.timeThreshold;
        const participantOverlap = conv.participants.includes(displayName);

        console.log(
          `Checking message ${message.id} against conversation ${conv.id}:`,
          {
            timeDiff,
            withinTime,
            participants: conv.participants,
            displayName,
            participantOverlap,
          },
        );

        if (withinTime && participantOverlap) {
          console.log(`Message ${message.id} added to conversation ${conv.id}`);
          conv.messages.push(message);

          if (!conv.participants.includes(displayName)) {
            conv.participants.push(displayName);
          }

          conv.lastActive = message.createdAt;
          this.messageIdToConversationId[message.id] = conv.id;
          assigned = true;
          break;
        }
      }

      if (!assigned) {
        console.log(
          `No matching conversation found for message ${message.id}. Creating a new conversation.`,
        );
        const newConversation: Conversation = {
          id: this.conversationIdCounter++,
          messages: [message],
          participants: [displayName],
          startTime: message.createdAt,
          lastActive: message.createdAt,
          conversationEmbedding: embedding ? embedding.slice() : undefined,
        };
        this.conversations.push(newConversation);
        this.messageIdToConversationId[message.id] = newConversation.id;
      }
    }
  }
  public getConversations(): Conversation[] {
    return this.conversations;
  }
}

async function getEmbeddingBatch(
  texts: string[],
  retryCount = 0,
): Promise<(number[] | null)[]> {
  const validTexts = texts.map((text) => text.trim()).filter((text) =>
    text && !/https?:\/\/\S+/.test(text)
  );

  if (validTexts.length === 0) {
    return texts.map(() => null);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 15000); // 15 seconds timeout

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        input: validTexts,
        model: "text-embedding-ada-002",
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Embedding API error:", response.statusText, errorData);

      if (response.status === 429 && retryCount < 5) {
        const waitTime = Math.pow(2, retryCount) * 1000;
        console.log(`Rate limit hit. Retrying in ${waitTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return await getEmbeddingBatch(texts, retryCount + 1);
      }

      return texts.map(() => null);
    }

    const data = await response.json();
    const embeddings = data.data.map((item: any) => item.embedding);

    const results: (number[] | null)[] = [];
    let embeddingIndex = 0;
    for (const text of texts) {
      if (text.trim() && !/https?:\/\/\S+/.test(text)) {
        results.push(embeddings[embeddingIndex++]);
      } else {
        results.push(null);
      }
    }

    return results;
  } catch (error) {
    clearTimeout(timeout);

    if ((error as Error).name === "AbortError") {
      console.error(
        "Request timed out for batch starting with text:",
        texts[0],
      );
    } else {
      console.error("Error fetching embeddings:", error);
    }
    return texts.map(() => null);
  }
}

export async function processMessageBatch(
  messages: Message<true>[],
  conversationManager: ConversationManager,
): Promise<void> {
  const limit = pLimit(5); // Limit concurrent API calls
  const batchSize = 20; // Adjust batch size as needed
  const batchedMessages: Message<true>[][] = [];

  for (let i = 0; i < messages.length; i += batchSize) {
    batchedMessages.push(messages.slice(i, i + batchSize));
  }

  for (const batch of batchedMessages) {
    console.log(
      `Processing batch starting at message timestamp ${
        batch[0].createdAt.toISOString()
      }`,
    );
    await limit(async () => {
      const texts = batch.map((message) => message.content?.trim() || "");
      const embeddings = await getEmbeddingBatch(texts);

      for (let i = 0; i < batch.length; i++) {
        await conversationManager.addMessageToConversations(
          batch[i],
          embeddings[i],
        );
      }
    });
  }
}
