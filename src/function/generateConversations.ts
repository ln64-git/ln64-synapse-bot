// conversationManager.ts

import type { Message } from "discord.js";
import type { Conversation } from "../types.ts";
import pLimit from "p-limit";

export class ConversationManager {
  private conversations: Conversation[] = [];
  private messageIdToConversationId: { [key: string]: number } = {};
  private conversationIdCounter = 0;
  private timeThreshold = 5 * 60 * 1000; // 5 minutes
  private similarityThreshold = 0.75; // Adjusted threshold

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
  ): Promise<void> {
    const displayName = message.member?.displayName || message.author.username;
    const referencedMessageId = message.reference?.messageId || null;
    const timestamp = message.createdAt.getTime();

    // Attempt to find an existing conversation
    let assigned = false;

    // 1. Check references: If the new message references a known message, join that conversation.
    if (
      referencedMessageId &&
      this.messageIdToConversationId[referencedMessageId] !== undefined
    ) {
      const refConvId = this.messageIdToConversationId[referencedMessageId];
      const refConv = this.conversations.find((c) => c.id === refConvId)!;
      refConv.messages.push(message);
      if (!refConv.participants.includes(displayName)) {
        refConv.participants.push(displayName);
      }
      refConv.lastActive = message.createdAt;
      this.messageIdToConversationId[message.id] = refConvId;
      assigned = true;
    }

    // 2. If no reference found, try participant/time-based heuristic:
    if (!assigned) {
      // Sort conversations by last active time if needed, or just check the most recent first.
      const recentConversation =
        this.conversations[this.conversations.length - 1];
      if (recentConversation) {
        const timeGap = timestamp - recentConversation.lastActive.getTime();
        const withinTime = timeGap < this.timeThreshold;
        const participantOverlap = recentConversation.participants.includes(
          displayName,
        );

        // If the author is already in the recent conversation and message is in short time gap, add it.
        if (withinTime && participantOverlap) {
          recentConversation.messages.push(message);
          if (!recentConversation.participants.includes(displayName)) {
            recentConversation.participants.push(displayName);
          }
          recentConversation.lastActive = message.createdAt;
          this.messageIdToConversationId[message.id] = recentConversation.id;
          assigned = true;
        }
      }
    }

    // 3. If still not assigned, start a new conversation
    if (!assigned) {
      const newConversation: Conversation = {
        id: this.conversationIdCounter++,
        messages: [message],
        participants: [displayName],
        startTime: message.createdAt,
        lastActive: message.createdAt,
        // Skip embeddings initially or set them later if needed
      };
      this.conversations.push(newConversation);
      this.messageIdToConversationId[message.id] = newConversation.id;
    }
  }

  // If using embeddings
  private updateConversationEmbedding(
    conv: Conversation,
    newMessageEmbedding: number[],
  ): void {
    if (!conv.conversationEmbedding) {
      conv.conversationEmbedding = newMessageEmbedding.slice();
    } else {
      // Average the embeddings
      const length = conv.messages.length;
      conv.conversationEmbedding = conv.conversationEmbedding.map((val, i) =>
        (val * (length - 1) + newMessageEmbedding[i]) / length
      );
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
): Promise<Conversation[]> {
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
        );
      }
    });
  }
  return conversationManager.getConversations();
}
