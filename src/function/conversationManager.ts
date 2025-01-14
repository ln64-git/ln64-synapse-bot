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

/**
 * Example function to batch-call the OpenAI Embedding API.
 * Replace with your own or adjust as needed.
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

      // Retry logic for 429 rate-limit
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
 * Weights object to let us dynamically compute mentionWeight, authorWeight, etc.
 */
interface SimilarityWeights {
  mentionWeight: number;
  authorWeight: number;
  adjacencyWeight: number;
  embeddingWeight: number;
  keywordWeight: number;
}

/**
 * Main conversation manager that organizes messages into topics and threads
 * with dynamic weighting and adjacency logic.
 */
export class ConversationManager {
  private topics: Topic[] = [];
  private conversationIdCounter = 0;

  /**
   * Allows older messages to still be considered part of an existing conversation (staleness).
   * E.g., 30 minutes. Adjust if your server has slower or faster-paced discussions.
   */
  private stalenessThreshold = 30 * 60 * 1000; // 30 minutes

  /**
   * Shorter "adjacency" threshold. If a new message arrives within e.g. 10 minutes, we consider
   * them closely related (boost adjacency score).
   */
  private ADJACENCY_THRESHOLD = 10 * 60 * 1000; // 10 minutes

  /**
   * Base threshold for deciding if a new message belongs to an existing topic
   * after weighting. If below this, start a new topic.
   */
  private TOPIC_SIMILARITY_THRESHOLD = 0.5;

  /**
   * Base threshold for deciding if a new message belongs to an existing thread.
   * If below this, start a new thread.
   */
  private THREAD_SIMILARITY_THRESHOLD = 0.4;

  // Cache to store extracted keywords + embeddings (avoids repeated API calls)
  private keywordCache: Map<
    string,
    { keywords: string[]; embedding: number[] | null }
  > = new Map();

  constructor() {
    // Additional init if needed
  }

  /**
   * Handle a new message: embed or skip embedding, extract or skip keywords, then find or create a topic & thread.
   */
  public async addMessageToTopics(message: Message<true>): Promise<void> {
    const displayName = message.member?.displayName || message.author.username;
    const referencedMessageId = message.reference?.messageId;

    const content = message.content.trim();
    const hasOnlyLinks = /^https?:\/\/\S+$/.test(content);
    const hasAttachments = message.attachments.size > 0;
    const hasOnlyAttachments = content.length === 0 && hasAttachments;
    const hasOnlyEmoticons = /^([^\w\s]|[\uD800-\uDBFF][\uDC00-\uDFFF])+$/.test(
      content,
    );

    // Instead of skipping short messages entirely, we only skip embedding for them
    // so that mention or adjacency logic can still place them correctly.
    let doEmbedding = true;
    let doKeywords = true;

    if (
      content.length === 0 || hasOnlyLinks || hasOnlyAttachments ||
      hasOnlyEmoticons
    ) {
      console.warn(
        `Message ID ${message.id} has minimal text. Skipping embedding but continuing for mention/time grouping.`,
      );
      doEmbedding = false;
      doKeywords = false;
    }

    // 1. Extract or retrieve cached keywords & embedding
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
      if (doKeywords) {
        const extracted = await extractKeywordsWithAI(content);
        messageKeywords = extracted;
      } else {
        // fallback, e.g. store short message or empty
        messageKeywords = content ? [content.toLowerCase()] : [];
      }

      if (doEmbedding && content.length >= 10) {
        // We'll do embedding only if not trivially short
        messageEmbedding = await this.embedNewMessage(content);
      } else {
        messageEmbedding = null;
      }

      this.keywordCache.set(message.id, {
        keywords: messageKeywords,
        embedding: messageEmbedding,
      });
      console.log(
        `Extracted and cached keywords for Message ID ${message.id}:`,
        messageKeywords,
      );
    }

    // 2. Convert message to extended type with embedding
    const messageWithEmbed = message as DiscordMessageWithEmbedding;
    messageWithEmbed.cleanContentEmbedding = messageEmbedding ?? undefined;

    // 3. Find or create a topic
    const relatedTopic = this.findRelatedTopic(
      messageWithEmbed,
      messageKeywords,
    );

    // 4. Within that topic, find or create a thread
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

    // 5. Assign to existing thread or start a new thread/topic
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
      this.startNewTopic(messageWithEmbed, messageKeywords, displayName);
    }
  }

  /**
   * Returns final topics, sorted by lastActive.
   */
  public getFormattedTopics(): object[] {
    return this.getTopics().map((topic) => {
      // Sort each thread’s messages by ascending timestamp
      topic.threads.forEach((thread) => {
        thread.messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      });

      return {
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
              attachments: msg.attachments.map((att: { url: string }) =>
                att.url
              ),
              mentions: msg.mentions.users.map((u) => u.username),
            },
          })),
          participants: thread.participants,
          startTime: thread.startTime.toISOString(),
          lastActive: thread.lastActive.toISOString(),
          keywords: thread.keywords,
        })),
        lastActive: topic.lastActive.toISOString(),
      };
    });
  }

  /**
   * Retrieve the sorted topics array.
   */
  public getTopics(): Topic[] {
    return this.topics.sort(
      (a, b) => b.lastActive.getTime() - a.lastActive.getTime(),
    );
  }

  /**
   * Finds a related topic. Weighted by embeddings + keywords only, for simplicity.
   * If you want mention or adjacency at the *topic* level, incorporate that as well.
   */
  private findRelatedTopic(
    message: DiscordMessageWithEmbedding,
    messageKeywords: string[],
  ): Topic | null {
    const messageEmbedding = message.cleanContentEmbedding;
    let bestMatch: Topic | null = null;
    let bestScore = -1;

    const debugScores: {
      topicId: number;
      combinedScore: number;
      embeddingSim: number;
      keywordOverlap: number;
    }[] = [];

    for (const topic of this.topics) {
      if (!topic.conversationEmbedding) continue;

      let embeddingSim = 0;
      if (messageEmbedding) {
        embeddingSim = this.cosineSimilarity(
          messageEmbedding,
          topic.conversationEmbedding,
        );
      }

      // Basic keyword overlap
      const overlapCount = messageKeywords.filter((kw) =>
        topic.keywords.includes(kw)
      ).length;
      const totalUnique = new Set([...topic.keywords, ...messageKeywords]).size;
      const keywordOverlap = totalUnique > 0 ? overlapCount / totalUnique : 0;

      // Example weighting for topic-level
      const combinedScore = embeddingSim * 0.8 + keywordOverlap * 0.2;

      debugScores.push({
        topicId: topic.id,
        combinedScore,
        embeddingSim,
        keywordOverlap,
      });

      if (combinedScore > bestScore) {
        bestScore = combinedScore;
        bestMatch = topic;
      }
    }

    console.log(
      `\nDEBUG: findRelatedTopic - Message ID ${message.id} ("${
        message.content.slice(
          0,
          40,
        )
      }...")`,
    );
    debugScores.forEach((info) => {
      console.log(
        `  Topic ID=${info.topicId} => combinedScore=${
          info.combinedScore.toFixed(3)
        }, 
      embeddingSim=${info.embeddingSim.toFixed(3)},
      keywordOverlap=${info.keywordOverlap.toFixed(3)}`,
      );
    });

    if (bestScore >= this.TOPIC_SIMILARITY_THRESHOLD) {
      console.log(
        `--> Selected Topic ID=${bestMatch?.id} with bestScore=${
          bestScore.toFixed(3)
        }\n`,
      );
      return bestMatch;
    }

    console.log("--> No topic passed threshold. Starting a new Topic.\n");
    return null;
  }

  /**
   * Finds a related thread within a topic, using dynamic weighting logic for mention, author, adjacency, etc.
   */
  private findRelatedThread(
    topic: Topic,
    message: DiscordMessageWithEmbedding,
    messageKeywords: string[],
    referencedMessageId?: string,
    displayName?: string,
  ): Thread | null {
    // A) If direct reference => short-circuit
    if (referencedMessageId) {
      for (const thread of topic.threads) {
        const referenced = thread.messages.find((m) =>
          m.id === referencedMessageId
        );
        if (referenced) {
          console.log(
            `DEBUG: Direct reply => Found Thread ID=${thread.id} via referencedMessageId=${referencedMessageId}`,
          );
          return thread;
        }
      }
    }

    let bestMatch: Thread | null = null;
    let bestScore = 0;

    // B) Get dynamic weights for *this* message
    const dynamicWeights = this.getDynamicWeights(message);

    // For debug
    const threadScoresDebug: {
      threadId: number;
      mentionScore: number;
      authorScore: number;
      adjacencyScore: number;
      embeddingSim: number;
      keywordOverlap: number;
      combinedScore: number;
    }[] = [];

    for (const thread of topic.threads) {
      // 1) mentionScore
      const mentionsParticipant = message.mentions.users.some((u) =>
        thread.participants.includes(u.username)
      );
      const mentionScore = mentionsParticipant ? 1 : 0;

      // 2) authorScore
      const sameAuthor = thread.participants.includes(displayName || "");
      const authorScore = sameAuthor ? 1 : 0;

      // 3) adjacencyScore
      let adjacencyScore = 0;
      const timeSinceLast = message.createdTimestamp -
        thread.lastActive.getTime();
      if (timeSinceLast >= 0 && timeSinceLast < this.ADJACENCY_THRESHOLD) {
        adjacencyScore = 1; // posted within adjacency threshold => big boost
      }

      // 4) embeddingSim
      let embeddingSim = 0;
      if (message.cleanContentEmbedding && thread.threadEmbedding) {
        embeddingSim = this.cosineSimilarity(
          message.cleanContentEmbedding,
          thread.threadEmbedding,
        );
      }

      // 5) keywordOverlap
      const overlapCount = messageKeywords.filter((kw) =>
        (thread.keywords || []).includes(kw)
      ).length;
      const totalUnique =
        new Set([...(thread.keywords || []), ...messageKeywords]).size;
      const keywordOverlap = totalUnique > 0 ? overlapCount / totalUnique : 0;

      // Weighted sum using dynamic weights
      const combinedScore = mentionScore * dynamicWeights.mentionWeight +
        authorScore * dynamicWeights.authorWeight +
        adjacencyScore * dynamicWeights.adjacencyWeight +
        embeddingSim * dynamicWeights.embeddingWeight +
        keywordOverlap * dynamicWeights.keywordWeight;

      threadScoresDebug.push({
        threadId: thread.id,
        mentionScore,
        authorScore,
        adjacencyScore,
        embeddingSim,
        keywordOverlap,
        combinedScore,
      });

      if (combinedScore > bestScore) {
        bestScore = combinedScore;
        bestMatch = thread;
      }
    }

    console.log(
      `\nDEBUG: findRelatedThread - Message ID ${message.id} ("${
        message.content.slice(0, 40)
      }...") in Topic ID=${topic.id}`,
    );
    threadScoresDebug.forEach((info) => {
      console.log(`
        Thread ID=${info.threadId}
          mentionScore=${info.mentionScore}
          authorScore=${info.authorScore}
          adjacencyScore=${info.adjacencyScore}
          embeddingSim=${info.embeddingSim.toFixed(3)}
          keywordOverlap=${info.keywordOverlap.toFixed(3)}
          combinedScore=${info.combinedScore.toFixed(3)}
      `);
    });

    // (Optional) dynamic threshold
    let dynamicThreadThreshold = this.THREAD_SIMILARITY_THRESHOLD;
    // Example: if message is short, we reduce threshold slightly
    if (message.content.length < 10) {
      dynamicThreadThreshold -= 0.05;
    }

    if (bestMatch && bestScore >= dynamicThreadThreshold) {
      console.log(
        `--> SELECTED Thread ID=${bestMatch.id} with combinedScore=${
          bestScore.toFixed(3)
        }\n`,
      );
      return bestMatch;
    }

    console.log("--> No thread passed threshold. Starting new thread.\n");
    return null;
  }

  /**
   * Example dynamic weighting function that adjusts mention/author/adjacency/embedding/keywords
   * based on message content length, presence of replies, etc.
   */
  private getDynamicWeights(
    message: DiscordMessageWithEmbedding,
  ): SimilarityWeights {
    const content = message.content.toLowerCase();
    const length = content.length;
    const isReply = Boolean(message.reference?.messageId);
    const hasMention = message.mentions.users.size > 0;

    // Start with some defaults
    let mentionWeight = 0.3;
    let authorWeight = 0.3;
    let adjacencyWeight = 0.4;
    let embeddingWeight = 0.15;
    let keywordWeight = 0.05;

    // If message is very short (< 10 chars), rely more on mention + adjacency
    if (length < 10) {
      embeddingWeight = 0.05;
      mentionWeight = 0.5;
      adjacencyWeight = 0.5;
    }

    // If it's a direct reply, or has mention => bump mention weight
    if (isReply) {
      mentionWeight += 0.2; // direct reply is strong
    }
    if (hasMention) {
      mentionWeight += 0.1;
    }

    // If message is long (> 100 chars), we trust embeddings more
    if (length > 100) {
      embeddingWeight += 0.1;
    }

    // Return final dynamic weights
    return {
      mentionWeight,
      authorWeight,
      adjacencyWeight,
      embeddingWeight,
      keywordWeight,
    };
  }

  /**
   * Assign a message to an existing thread, re-average embeddings, update participants, etc.
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

    // Sort by ascending timestamp so oldest -> newest

    thread.messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // Add author if not present
    if (!thread.participants.includes(displayName)) {
      thread.participants.push(displayName);
    }
    // Add any mentioned users
    message.mentions.users.forEach((u) => {
      if (!thread.participants.includes(u.username)) {
        thread.participants.push(u.username);
      }
    });

    // Update thread keywords
    thread.keywords = Array.from(
      new Set([...(thread.keywords || []), ...messageKeywords]),
    );

    // Recompute thread embedding
    if (message.cleanContentEmbedding) {
      thread.threadEmbedding = this.averageEmbeddings(
        thread.threadEmbedding,
        message.cleanContentEmbedding,
        thread.messageCount,
      );
      // Also update topic's conversation embedding
      topic.conversationEmbedding = this.averageEmbeddings(
        topic.conversationEmbedding,
        message.cleanContentEmbedding,
        topic.messageCount + 1, // or track separately
      );
    }

    // Update topic stats
    topic.messageCount += 1;
    topic.lastActive = new Date(message.createdTimestamp);

    console.log(
      `Assigned Message ID ${message.id} to Thread ID ${thread.id} under Topic ID ${topic.id}.`,
    );
  }

  /**
   * Start a new thread inside an existing topic.
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
      participants: [
        displayName,
        ...message.mentions.users.map((u) => u.username),
      ],
      startTime: new Date(message.createdTimestamp),
      lastActive: new Date(message.createdTimestamp),
      keywords: messageKeywords,
      threadEmbedding: message.cleanContentEmbedding ?? undefined,
    };

    topic.threads.push(newThread);
    topic.messageCount += 1;
    topic.lastActive = new Date(message.createdTimestamp);

    console.log(
      `Started new Thread ID ${newThread.id} under Topic ID ${topic.id}.`,
    );
  }

  /**
   * Start a brand-new topic + its first thread.
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
      participants: [
        displayName,
        ...message.mentions.users.map((u) => u.username),
      ],
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
    console.log(
      `Started new Topic ID ${newTopic.id} with Thread ID ${newThread.id}.`,
    );
  }

  /**
   * Helper to embed a single text (uses getEmbeddingBatch for convenience).
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
   * Utility to average embeddings (incremental approach).
   */
  private averageEmbeddings(
    existingEmbedding: number[] | undefined,
    newEmbedding: number[],
    itemCount: number,
  ): number[] {
    if (!existingEmbedding) {
      return newEmbedding;
    }
    return existingEmbedding.map((val, idx) => {
      return (val * (itemCount - 1) + newEmbedding[idx]) / itemCount;
    });
  }

  /**
   * Basic cosine similarity measure: dot product / (normA * normB).
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
