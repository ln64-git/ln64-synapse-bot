// conversationManager.ts

import type { Message } from "discord.js";
import type { Conversation } from "../types.ts";
import pLimit from "p-limit";

export class ConversationManager {
  private conversations: Conversation[] = [];
  private messageIdToConversationId: { [key: string]: number } = {};
  private conversationIdCounter = 0;

  // Configurable thresholds
  private timeThreshold = 5 * 60 * 1000; // 5 minutes for recent participant match
  private similarityThreshold = 0.85; // Slightly increased from 0.8
  private stalenessThreshold = 30 * 60 * 1000; // 30 minutes stale
  private minSimilarityForConversation = 0.6; // Increased from 0.5
  private hardTimeGap = 60 * 60 * 1000; // 1 hour
  private shortMessageWordCount = 3; // If message <= 3 words, treat as short
  private localContextSize = 3; // Number of recent messages to consider for local context
  private driftThreshold = 0.3; // If last message differs a lot from convo embedding, consider topic shift

  constructor() {}

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) {
      return 0;
    }

    const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dotProduct / (magnitudeA * magnitudeB);
  }

  private updateConversationEmbedding(
    conv: Conversation,
    newEmbedding: number[],
  ) {
    if (!conv.conversationEmbedding) {
      conv.conversationEmbedding = newEmbedding.slice();
      return;
    }

    const count = conv.messages.length;
    const oldEmbedding = conv.conversationEmbedding;
    for (let i = 0; i < oldEmbedding.length; i++) {
      oldEmbedding[i] = (oldEmbedding[i] * (count - 1) + newEmbedding[i]) /
        count;
    }
    conv.conversationEmbedding = oldEmbedding;
  }

  private getMessageEmbedding(msg: Message<true>): number[] | undefined {
    return (msg as any).embedding;
  }

  private assignMessageToConversation(
    conv: Conversation,
    message: Message<true>,
    embedding: number[] | null,
    displayName: string,
  ) {
    conv.messages.push(message);
    if (!conv.participants.includes(displayName)) {
      conv.participants.push(displayName);
    }

    conv.lastActive = message.createdAt;
    this.messageIdToConversationId[message.id] = conv.id;

    if (embedding) {
      (message as any).embedding = embedding;
      this.updateConversationEmbedding(conv, embedding);

      // Check for drift:
      const sim = this.cosineSimilarity(embedding, conv.conversationEmbedding!);
      if (1 - sim > this.driftThreshold) {
        // We've detected a large drift. We might consider
        // raising thresholds or simply accept that the next semantically distant message starts a new convo.
        // For simplicity, let's just store a flag:
        (conv as any).driftDetected = true;
      }
    }
  }

  private findRecentConversationForUser(
    displayName: string,
    timestamp: number,
  ): Conversation | null {
    for (let i = this.conversations.length - 1; i >= 0; i--) {
      const conv = this.conversations[i];
      const timeDiff = timestamp - conv.lastActive.getTime();
      const withinTime = timeDiff < this.timeThreshold;
      const participantOverlap = conv.participants.includes(displayName);
      if (withinTime && participantOverlap) {
        return conv;
      }
    }
    return null;
  }

  private averageEmbeddings(embeddings: number[][]): number[] {
    if (embeddings.length === 0) return [];
    const length = embeddings[0].length;
    const avg = new Array(length).fill(0);
    for (const emb of embeddings) {
      for (let i = 0; i < length; i++) {
        avg[i] += emb[i];
      }
    }
    for (let i = 0; i < length; i++) {
      avg[i] /= embeddings.length;
    }
    return avg;
  }

  private getLocalContextEmbedding(conv: Conversation): number[] | null {
    // Take the last few message embeddings and average them
    const embeddings: number[][] = [];
    for (
      let i = conv.messages.length - 1;
      i >= 0 && i >= conv.messages.length - this.localContextSize;
      i--
    ) {
      const e = this.getMessageEmbedding(conv.messages[i]);
      if (e) embeddings.push(e);
    }

    if (embeddings.length === 0) return null;
    return this.averageEmbeddings(embeddings);
  }

  private findBestConversationByEmbedding(
    embedding: number[],
    timestamp: number,
  ): Conversation | null {
    let bestConv: Conversation | null = null;
    let bestSimilarity = -1;

    for (const conv of this.conversations) {
      if (!conv.conversationEmbedding) continue;

      const similarity = this.cosineSimilarity(
        embedding,
        conv.conversationEmbedding,
      );
      const timeDiff = timestamp - conv.lastActive.getTime();
      const isStale = timeDiff > this.stalenessThreshold;

      let requiredSim = this.similarityThreshold;
      if (isStale) requiredSim = Math.max(requiredSim, 0.9);

      const isVeryOld = timeDiff > this.hardTimeGap;
      if (isVeryOld) requiredSim = Math.max(requiredSim, 0.95);

      // If drift was detected in this conversation, be even stricter:
      if ((conv as any).driftDetected) {
        requiredSim = Math.max(requiredSim, 0.9);
      }

      if (
        similarity >= this.minSimilarityForConversation &&
        similarity > bestSimilarity &&
        similarity >= requiredSim
      ) {
        // Additional local context check:
        const localEmbedding = this.getLocalContextEmbedding(conv);
        if (localEmbedding) {
          const localSim = this.cosineSimilarity(embedding, localEmbedding);
          if (localSim < this.minSimilarityForConversation) {
            // Doesn't match local context well enough, skip
            continue;
          }
        }

        bestSimilarity = similarity;
        bestConv = conv;
      }
    }

    return bestConv;
  }

  private startNewConversation(
    message: Message<true>,
    embedding: number[] | null,
    displayName: string,
  ) {
    const newConversation: Conversation = {
      id: this.conversationIdCounter++,
      messages: [message],
      participants: [displayName],
      startTime: message.createdAt,
      lastActive: message.createdAt,
      conversationEmbedding: embedding ? embedding.slice() : undefined,
    };
    if (embedding) (message as any).embedding = embedding;
    this.conversations.push(newConversation);
    this.messageIdToConversationId[message.id] = newConversation.id;
  }

  private isShortMessage(content: string): boolean {
    const words = content.trim().split(/\s+/);
    return words.length <= this.shortMessageWordCount;
  }

  public async addMessageToConversations(
    message: Message<true>,
    embedding: number[] | null,
  ): Promise<void> {
    const displayName = message.member?.displayName || message.author.username;
    const referencedMessageId = message.reference?.messageId;
    const timestamp = message.createdAt.getTime();
    const content = message.content?.trim() || "";
    const shortMessage = this.isShortMessage(content);

    let assigned = false;

    // 1. Reference-based
    if (
      referencedMessageId &&
      this.messageIdToConversationId[referencedMessageId] !== undefined
    ) {
      const convId = this.messageIdToConversationId[referencedMessageId];
      const conv = this.conversations.find((c) => c.id === convId)!;
      this.assignMessageToConversation(conv, message, embedding, displayName);
      assigned = true;
    }

    // 2. Participant/time-based
    if (!assigned) {
      const recentConv = this.findRecentConversationForUser(
        displayName,
        timestamp,
      );
      if (recentConv) {
        // Check local continuity: if embedding is available, verify it's not drastically off-topic
        if (embedding) {
          const localEmb = this.getLocalContextEmbedding(recentConv);
          if (localEmb) {
            const localSim = this.cosineSimilarity(embedding, localEmb);
            if (localSim < this.minSimilarityForConversation) {
              // Too different from recent context, do not assign here
            } else {
              this.assignMessageToConversation(
                recentConv,
                message,
                embedding,
                displayName,
              );
              assigned = true;
            }
          } else {
            // No local embedding or no embedding, just assign on participant/time basis
            this.assignMessageToConversation(
              recentConv,
              message,
              embedding,
              displayName,
            );
            assigned = true;
          }
        } else {
          // No embedding, trust participant/time heuristic
          this.assignMessageToConversation(
            recentConv,
            message,
            embedding,
            displayName,
          );
          assigned = true;
        }
      }
    }

    // 3. Embedding-based
    if (!assigned && embedding) {
      // If the message is short and we have no matches yet, be cautious
      // If short message does not strongly match a conversation, start new one
      const bestConv = this.findBestConversationByEmbedding(
        embedding,
        timestamp,
      );
      if (bestConv) {
        this.assignMessageToConversation(
          bestConv,
          message,
          embedding,
          displayName,
        );
        assigned = true;
      } else if (shortMessage) {
        // Short message not fitting anywhere strongly -> new conversation
      }
    }

    // 4. Start a new conversation if still not assigned
    if (!assigned) {
      this.startNewConversation(message, embedding, displayName);
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
        // Now pass the embedding as the second argument
        await conversationManager.addMessageToConversations(
          batch[i],
          embeddings[i],
        );
      }
    });
  }

  return conversationManager.getConversations();
}
