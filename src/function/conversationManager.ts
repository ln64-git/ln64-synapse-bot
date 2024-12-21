import type { Message } from "discord.js";
import type { Conversation } from "../types.ts";
import pLimit from "p-limit";

export class ConversationManager {
  private conversations: Conversation[] = [];
  private messageIdToConversationId: { [key: string]: number } = {};
  private conversationIdCounter = 0;

  // Configurable thresholds
  private timeThreshold = 2 * 60 * 1000; // 2 minutes for recent participant match
  private similarityThreshold = 0.9; // Similarity threshold for embeddings
  private stalenessThreshold = 15 * 60 * 1000; // 15 minutes for stale conversations
  private localContextSize = 5; // Number of recent messages to consider for context

  constructor() {}

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) return 0;

    const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dotProduct / (magnitudeA * magnitudeB);
  }

  private findExistingConversation(
    message: Message<true>,
    embedding: number[] | null,
    displayName: string,
  ): Conversation | null {
    // Check if a matching conversation already exists
    const timestamp = message.createdAt.getTime();
    for (const conv of this.conversations) {
      const timeDiff = timestamp - conv.lastActive.getTime();

      // Match by participants and time
      if (
        conv.participants.includes(displayName) && timeDiff < this.timeThreshold
      ) {
        return conv;
      }

      // Match by semantic similarity if embedding exists
      if (embedding && conv.conversationEmbedding) {
        const similarity = this.cosineSimilarity(
          embedding,
          conv.conversationEmbedding,
        );
        if (similarity >= this.similarityThreshold) {
          return conv;
        }
      }
    }

    return null;
  }

  public async addMessageToConversations(
    message: Message<true>,
    embedding: number[] | null,
  ): Promise<void> {
    const displayName = message.member?.displayName || message.author.username;
    const referencedMessageId = message.reference?.messageId;

    // Step 1: Handle direct replies
    if (
      referencedMessageId &&
      this.messageIdToConversationId[referencedMessageId] !== undefined
    ) {
      const convId = this.messageIdToConversationId[referencedMessageId];
      const conv = this.conversations.find((c) => c.id === convId)!;
      this.assignMessageToConversation(conv, message, embedding, displayName);
      return;
    }

    // Step 2: Check for an existing conversation
    const existingConversation = this.findExistingConversation(
      message,
      embedding,
      displayName,
    );
    if (existingConversation) {
      this.assignMessageToConversation(
        existingConversation,
        message,
        embedding,
        displayName,
      );
      return;
    }

    // Step 3: Start a new conversation
    this.startNewConversation(message, embedding, displayName);
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
    conv.conversationEmbedding = conv.conversationEmbedding.map((val, i) =>
      (val * (count - 1) + newEmbedding[i]) / count
    );
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
      this.updateConversationEmbedding(conv, embedding);
    }

    // Generate keywords for the message and add them to the conversation
    const keywords = this.extractKeywords(message.content);
    conv.keywords = Array.from(
      new Set([...(conv.keywords || []), ...keywords]),
    );
  }

  private extractKeywords(content: string): string[] {
    // Basic keyword extraction logic (replace with a more advanced NLP library if needed)
    return content
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 3); // Filter out short/common words
  }

  private findRecentConversationForUser(
    displayName: string,
    timestamp: number,
  ): Conversation | null {
    return this.conversations
      .filter((conv) =>
        conv.participants.includes(displayName) &&
        timestamp - conv.lastActive.getTime() < this.timeThreshold
      )
      .pop() || null;
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
      const requiredSim = isStale
        ? Math.max(this.similarityThreshold, 0.95)
        : this.similarityThreshold;

      if (similarity >= requiredSim && similarity > bestSimilarity) {
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
    const keywords = this.extractKeywords(message.content);

    const newConversation: Conversation = {
      id: this.conversationIdCounter++,
      messages: [message],
      participants: [displayName],
      startTime: message.createdAt,
      lastActive: message.createdAt,
      conversationEmbedding: embedding ? embedding.slice() : undefined,
      keywords,
    };

    this.conversations.push(newConversation);
    this.messageIdToConversationId[message.id] = newConversation.id;
  }

  public getConversations(): Conversation[] {
    return this.conversations;
  }
}

export async function processMessageBatch(
  messages: Message<true>[],
  conversationManager: ConversationManager,
): Promise<Conversation[]> {
  const limit = pLimit(5);
  const batchSize = 20;

  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    const texts = batch.map((msg) => msg.content.trim());
    const embeddings = await getEmbeddingBatch(texts);

    await Promise.all(
      batch.map((message, index) =>
        limit(() =>
          conversationManager.addMessageToConversations(
            message,
            embeddings[index],
          )
        )
      ),
    );
  }

  return conversationManager.getConversations();
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
