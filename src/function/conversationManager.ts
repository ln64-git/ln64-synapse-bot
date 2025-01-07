// conversationManagerWithAI.ts

import type { Message } from "discord.js";
import type {
  DiscordMessageWithEmbedding,
  Thread,
  Topic,
} from "../types/types";
import dotenv from "dotenv";
import { extractKeywordsWithAI } from "./extractKeywords";

dotenv.config();

export class ConversationManager {
  private topics: Topic[] = [];
  private conversationIdCounter = 0;

  /**
   * The time threshold (in ms) for determining if a new message might still
   * fit into an existing conversation thread. (Here set to 10 minutes.)
   */
  private stalenessThreshold = 10 * 60 * 1000; // 10 minutes for temporal proximity

  /**
   * Threshold for vector similarity. Adjust/tune to your use case.
   * 1.0 = identical vectors, 0 = completely dissimilar.
   * Something ~ 0.75 - 0.85 can be a decent starting guess.
   */
  private SIMILARITY_THRESHOLD = 0.75;

  // Cache to store keywords and embeddings for messages to reduce redundant API calls
  private keywordCache: Map<
    string,
    { keywords: string[]; embedding: number[] | null }
  > = new Map();

  constructor() {
    // Initialize any required properties if needed
  }

  /**
   * Public method to handle a new message (from your Discord fetch or event listener)
   * and slot it into the appropriate topic and thread or start a new one.
   * Utilizes AI-based keyword extraction for enhanced accuracy.
   */
  public async addMessageToTopics(
    message: Message<true>,
  ): Promise<void> {
    // Basic display name or fallback to username
    const displayName = message.member?.displayName || message.author.username;

    // The ID of the message that this new one is referencing (if any).
    const referencedMessageId = message.reference?.messageId;

    // **Pre-Processing: Check if message contains only links, attachments, or emoticons**
    const content = message.content.trim();
    const hasOnlyLinks = /^https?:\/\/\S+$/.test(content);
    const hasAttachments = message.attachments.size > 0;
    const hasOnlyAttachments = content.length === 0 && hasAttachments;
    const hasOnlyEmoticons = /^([^\w\s]|[\uD800-\uDBFF][\uDC00-\uDFFF])+$/.test(
      content,
    );
    const MIN_CONTENT_LENGTH = 10; // Adjust based on your needs

    // Skip messages that have no meaningful textual content
    if (
      content.length < MIN_CONTENT_LENGTH ||
      hasOnlyLinks ||
      hasOnlyAttachments ||
      hasOnlyEmoticons
    ) {
      console.warn(
        `Message ID ${message.id} is insufficient for keyword extraction. Skipping.`,
      );
      return;
    }

    // 1. Extract keywords using AI
    let messageKeywords: string[] = [];
    let messageEmbedding: number[] | null = null;

    if (this.keywordCache.has(message.id)) {
      const cached = this.keywordCache.get(message.id)!;
      messageKeywords = cached.keywords;
      messageEmbedding = cached.embedding;
      console.log(
        `Retrieved cached keywords for Message ID ${message.id}:`,
        messageKeywords,
      );
    } else {
      messageKeywords = await extractKeywordsWithAI(content);
      messageEmbedding = await this.embedNewMessage(content);
      this.keywordCache.set(message.id, {
        keywords: messageKeywords,
        embedding: messageEmbedding,
      });
      console.log(
        `Extracted and cached keywords for Message ID ${message.id}:`,
        messageKeywords,
      );
    }

    // Skip processing if no valid keywords
    if (messageKeywords.length === 0) {
      console.warn(`No valid keywords extracted for Message ID: ${message.id}`);
      return;
    }

    // 2. Create an extended "message" object that includes embeddings
    const messageWithEmbed = message as DiscordMessageWithEmbedding;
    messageWithEmbed.cleanContentEmbedding = messageEmbedding ?? undefined;

    // 3. Attempt to find an existing topic that this message relates to
    const relatedTopic = this.findRelatedTopic(
      messageWithEmbed,
      messageKeywords,
    );

    // 4. Within the related topic, attempt to find a related thread
    let relatedThread: Thread | null = null;
    if (relatedTopic) {
      relatedThread = this.findRelatedThread(
        relatedTopic,
        messageWithEmbed,
        messageKeywords,
        referencedMessageId,
        displayName,
      );
    }

    // 5. Assign the message to the appropriate thread or start a new thread within the topic
    if (relatedTopic && relatedThread) {
      this.assignMessageToThread(
        relatedThread,
        messageWithEmbed,
        messageKeywords,
        displayName,
        relatedTopic,
      );
    } else if (relatedTopic) {
      this.startNewThread(
        relatedTopic,
        messageWithEmbed,
        messageKeywords,
        displayName,
      );
    } else {
      this.startNewTopic(
        messageWithEmbed,
        messageKeywords,
        displayName,
      );
    }
  }

  /**
   * Return a sorted list of topics and their threads, typically for final consumption or logging.
   */
  public getFormattedTopics(): object[] {
    return this.getTopics().map((topic) => ({
      id: topic.id,
      keywords: topic.keywords,
      threads: topic.threads.map((thread) => ({
        id: thread.id,
        messageCount: thread.messageCount,
        messages: thread.messages.map((msg) => ({
          timestamp: msg.createdTimestamp,
          server: msg.guild?.name,
          channel: msg.channel.name,
          message: {
            content: msg.content,
            author: msg.author.username,
            attachments: msg.attachments.map((att: { url: string }) => att.url),
            mentions: msg.mentions.users.map((user: { username: string }) =>
              user.username
            ),
          },
        })),
        participants: thread.participants,
        startTime: thread.startTime.toISOString(),
        lastActive: thread.lastActive.toISOString(),
        keywords: thread.keywords,
      })),
      lastActive: topic.lastActive.toISOString(),
    }));
  }

  /**
   * Find a related topic based on vector similarity.
   * @param message - The message with embedding.
   * @param messageKeywords - The extracted keywords from the message.
   * @returns A related topic if found; otherwise, null.
   */
  private findRelatedTopic(
    message: DiscordMessageWithEmbedding,
    messageKeywords: string[],
  ): Topic | null {
    const messageEmbedding = message.cleanContentEmbedding;

    if (!messageEmbedding) {
      return null;
    }

    let bestMatch: Topic | null = null;
    let bestScore = -1;

    for (const topic of this.topics) {
      if (topic.conversationEmbedding) {
        const sim = this.cosineSimilarity(
          messageEmbedding,
          topic.conversationEmbedding,
        );
        if (sim > bestScore) {
          bestScore = sim;
          bestMatch = topic;
        }
      }
    }

    if (bestScore >= this.SIMILARITY_THRESHOLD) {
      console.log(
        `Found related Topic ID ${
          bestMatch!.id
        } with similarity score ${bestScore}`,
      );
      return bestMatch;
    }
    console.log("No related topic found based on similarity.");
    return null;
  }

  /**
   * Find a related thread within a topic based on references, mentions, keywords overlap, and temporal proximity.
   * @param topic - The topic to search within.
   * @param message - The message with embedding.
   * @param messageKeywords - The extracted keywords from the message.
   * @param referencedMessageId - (Optional) The ID of the referenced message.
   * @param displayName - (Optional) The display name of the message author.
   * @returns A related thread if found; otherwise, null.
   */
  private findRelatedThread(
    topic: Topic,
    message: DiscordMessageWithEmbedding,
    messageKeywords: string[],
    referencedMessageId?: string,
    displayName?: string,
  ): Thread | null {
    const messageEmbedding = message.cleanContentEmbedding;

    if (!messageEmbedding) {
      return null;
    }

    // 1. Check if the new message directly references a message within an existing thread
    if (referencedMessageId) {
      for (const thread of topic.threads) {
        const referencedMessage = thread.messages.find((msg) =>
          msg.id === referencedMessageId
        );
        if (referencedMessage) {
          console.log(
            `Found referenced Thread ID ${thread.id} in Topic ID ${topic.id}`,
          );
          return thread;
        }
      }
    }

    // 2. Evaluate each thread for potential match
    let bestMatch: Thread | null = null;
    let bestScore = -1;

    for (const thread of topic.threads) {
      const isParticipantRelated =
        thread.participants.includes(displayName || "") ||
        message.mentions.users.some((user) =>
          thread.participants.includes(user.username)
        );

      const hasMentionOverlap = thread.messages.some((msg) =>
        msg.mentions.users.some((mention: { id: string }) =>
          message.mentions.users.some((user) => user.id === mention.id)
        )
      );

      const hasKeywordOverlap = (thread.keywords ?? []).some((keyword) =>
        messageKeywords.includes(keyword)
      );

      const isWithinTimeThreshold = Math.abs(
        message.createdTimestamp - thread.lastActive.getTime(),
      ) < this.stalenessThreshold;

      if (
        (isParticipantRelated || hasMentionOverlap || hasKeywordOverlap) &&
        isWithinTimeThreshold &&
        messageEmbedding &&
        thread.threadEmbedding
      ) {
        const sim = this.cosineSimilarity(
          messageEmbedding,
          thread.threadEmbedding,
        );
        if (sim > bestScore) {
          bestScore = sim;
          bestMatch = thread;
        }
      }
    }

    if (bestMatch && bestScore >= this.SIMILARITY_THRESHOLD) {
      console.log(
        `Found related Thread ID ${bestMatch.id} with similarity score ${bestScore}`,
      );
      return bestMatch;
    }

    console.log(
      "No related thread found within the topic based on similarity and other criteria.",
    );
    return null;
  }

  /**
   * Assign the new message to an existing thread. Also re-average
   * the thread’s embedding if the new message has an embedding.
   * @param thread - The thread to assign the message to.
   * @param message - The message with embedding.
   * @param messageKeywords - The extracted keywords from the message.
   * @param displayName - The display name of the message author.
   * @param topic - The topic to which the thread belongs.
   */
  private assignMessageToThread(
    thread: Thread,
    message: DiscordMessageWithEmbedding,
    messageKeywords: string[],
    displayName: string,
    topic: Topic,
  ): void {
    thread.messages.push(message);
    thread.messageCount += 1;
    thread.lastActive = new Date(message.createdTimestamp);

    // Add author to participants if not present
    if (!thread.participants.includes(displayName)) {
      thread.participants.push(displayName);
    }

    // Add mentioned users to participants
    message.mentions.users.forEach((user) => {
      if (!thread.participants.includes(user.username)) {
        thread.participants.push(user.username);
      }
    });

    // Update keywords ensuring uniqueness
    thread.keywords = Array.from(
      new Set([...(thread.keywords || []), ...messageKeywords]),
    );

    // Recompute thread embedding by averaging with the new message embedding
    if (message.cleanContentEmbedding) {
      thread.threadEmbedding = this.averageEmbeddings(
        thread.threadEmbedding,
        message.cleanContentEmbedding,
        thread.messageCount,
      );

      // Also update the topic's embedding
      topic.conversationEmbedding = this.averageEmbeddings(
        topic.conversationEmbedding,
        message.cleanContentEmbedding,
        topic.messageCount,
      );
    }

    // Update topic's message count and last active
    topic.messageCount += 1;
    topic.lastActive = new Date(message.createdTimestamp);

    // Log the assignment
    console.log(
      `Assigned Message ID ${message.id} to Thread ID ${thread.id} under Topic ID ${topic.id}.`,
    );
  }

  /**
   * Start a new thread within an existing topic.
   * @param topic - The topic to which the new thread belongs.
   * @param message - The message with embedding.
   * @param messageKeywords - The extracted keywords from the message.
   * @param displayName - The display name of the message author.
   */
  private startNewThread(
    topic: Topic,
    message: DiscordMessageWithEmbedding,
    messageKeywords: string[],
    displayName: string,
  ): void {
    const newThread: Thread = {
      id: this.conversationIdCounter++,
      messageCount: 1,
      messages: [message],
      participants: [displayName],
      startTime: new Date(message.createdTimestamp),
      lastActive: new Date(message.createdTimestamp),
      keywords: messageKeywords,
      threadEmbedding: message.cleanContentEmbedding ?? undefined,
    };
    topic.threads.push(newThread);
    topic.messageCount += 1;
    topic.lastActive = new Date(message.createdTimestamp);

    // Log the new thread creation
    console.log(
      `Started new Thread ID ${newThread.id} under Topic ID ${topic.id}.`,
    );
  }

  /**
   * Start a new topic and its first thread.
   * @param message - The message with embedding.
   * @param messageKeywords - The extracted keywords from the message.
   * @param displayName - The display name of the message author.
   */
  private startNewTopic(
    message: DiscordMessageWithEmbedding,
    messageKeywords: string[],
    displayName: string,
  ): void {
    const newThread: Thread = {
      id: this.conversationIdCounter++,
      messageCount: 1,
      messages: [message],
      participants: [displayName],
      startTime: new Date(message.createdTimestamp),
      lastActive: new Date(message.createdTimestamp),
      keywords: messageKeywords,
      threadEmbedding: message.cleanContentEmbedding ?? undefined,
    };

    const newTopic: Topic = {
      id: this.conversationIdCounter++,
      messageCount: 1,
      threads: [newThread],
      participants: [displayName],
      startTime: new Date(message.createdTimestamp),
      lastActive: new Date(message.createdTimestamp),
      keywords: messageKeywords,
      conversationEmbedding: message.cleanContentEmbedding ?? undefined,
    };

    this.topics.push(newTopic);

    // Log the new topic creation
    console.log(
      `Started new Topic ID ${newTopic.id} with Thread ID ${newThread.id}.`,
    );
  }

  /**
   * Returns the list of topics, sorted by most recent lastActive.
   */
  public getTopics(): Topic[] {
    return this.topics.sort(
      (a, b) => b.lastActive.getTime() - a.lastActive.getTime(),
    );
  }

  /**
   * Helper to fetch an embedding for a single text using your existing getEmbeddingBatch().
   * This is a minimal wrapper; you could also do in-line calls if you prefer.
   * @param text - The text to embed.
   * @returns The embedding vector or null if failed.
   */
  private async embedNewMessage(text: string): Promise<number[] | null> {
    try {
      const [embedding] = await getEmbeddingBatch([text]);
      return embedding;
    } catch (error) {
      console.error("Error embedding new message:", error);
      return null;
    }
  }

  /**
   * Utility to average embeddings for conversation-level representation.
   * Weighted by the new item count so that each message counts equally.
   * @param existingEmbedding - The existing embedding vector.
   * @param newEmbedding - The new embedding vector to average with.
   * @param itemCount - The total number of items included so far.
   * @returns The averaged embedding vector.
   */
  private averageEmbeddings(
    existingEmbedding: number[] | undefined,
    newEmbedding: number[],
    itemCount: number,
  ): number[] {
    // If no existing embedding, just return the new one
    if (!existingEmbedding) {
      return newEmbedding;
    }
    // Weighted average for each dimension
    return existingEmbedding.map((val, idx) => {
      return (val * (itemCount - 1) + newEmbedding[idx]) / itemCount;
    });
  }

  /**
   * Basic cosine similarity measure: dot product / (normA * normB).
   * @param vec1 - First vector.
   * @param vec2 - Second vector.
   * @returns Cosine similarity between vec1 and vec2.
   */
  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    const dot = vec1.reduce((acc, val, i) => acc + val * vec2[i], 0);
    const normA = Math.sqrt(vec1.reduce((acc, val) => acc + val * val, 0));
    const normB = Math.sqrt(vec2.reduce((acc, val) => acc + val * val, 0));
    if (normA === 0 || normB === 0) {
      return 0;
    }
    return dot / (normA * normB);
  }
}

/**
 * The function that calls the OpenAI Embedding API to batch-embed texts.
 * Ensure that this function is correctly imported or defined in your project.
 */
export async function getEmbeddingBatch(
  texts: string[],
  retryCount = 0,
): Promise<(number[] | null)[]> {
  const validTexts = texts
    .map((text) => text.trim())
    .filter((text) => text && !/https?:\/\/\S+/.test(text));

  if (validTexts.length === 0) {
    return texts.map(() => null);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 15000); // 15s

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

/**
 * Example usage of your conversation manager with a batch of messages.
 */
export async function processMessages(
  messages: Message<true>[],
  conversationManager: ConversationManager,
): Promise<void> {
  await Promise.all(
    messages.map((message) => conversationManager.addMessageToTopics(message)),
  );
}
