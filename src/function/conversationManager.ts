// conversationManagerWithEmbeddings.ts

import type { Message } from "discord.js";
import type { Conversation, DiscordMessageWithEmbedding } from "../types/types";
import natural from "natural";

export class ConversationManager {
  private conversations: Conversation[] = [];
  private messageIdToConversationId: { [key: string]: number } = {};
  private conversationIdCounter = 0;

  /**
   * The time threshold (in ms) for determining if a new message might still
   * fit into an existing conversation. (Here set to 10 minutes.)
   */
  private stalenessThreshold = 10 * 60 * 1000; // 10 minutes for temporal proximity

  /**
   * Threshold for vector similarity. Adjust/tune to your use case.
   * 1.0 = identical vectors, 0 = completely dissimilar.
   * Something ~ 0.75 - 0.85 can be a decent starting guess.
   */
  private SIMILARITY_THRESHOLD = 0.75;

  constructor() {}

  /**
   * Public method to handle a new message (from your Discord fetch or event listener)
   * and slot it into the appropriate conversation or start a new one.
   * Notice how we embed the message (via embedNewMessage) before continuing.
   */
  public async addMessageToConversations(
    message: Message<true>,
  ): Promise<void> {
    // Basic display name or fallback to username
    const displayName = message.member?.displayName || message.author.username;

    // The ID of the message that this new one is referencing (if any).
    // This helps with "reply threading".
    const referencedMessageId = message.reference?.messageId;

    // Extract simple keywords from content
    const messageKeywords = this.extractKeywords(message.content);

    // 1. Generate or fetch an embedding for the new message
    const messageEmbedding = await this.embedNewMessage(message.content);

    // 2. Create an extended "message" object that includes embeddings
    const messageWithEmbed = message as DiscordMessageWithEmbedding;
    messageWithEmbed.cleanContentEmbedding = messageEmbedding ?? undefined;

    // 3. Attempt to find an existing conversation that this message relates to
    const relatedConversation = this.findRelatedConversation(
      messageWithEmbed,
      displayName,
      referencedMessageId,
    );

    // 4. Assign the message to that conversation or start a new one
    if (relatedConversation) {
      this.assignMessageToConversation(
        relatedConversation,
        messageWithEmbed,
        messageKeywords,
        displayName,
      );
    } else {
      this.startNewConversation(
        messageWithEmbed,
        messageKeywords,
        displayName,
      );
    }
  }

  /**
   * Return a sorted list of conversations, typically for final consumption or logging.
   */
  public getFormattedConversations(): object[] {
    return this.getConversations().map((conversation) => ({
      id: conversation.id,
      messageCount: conversation.messageCount,
      messages: conversation.messages.map((msg) => ({
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
      participants: conversation.participants,
      startTime: conversation.startTime.toISOString(),
      lastActive: conversation.lastActive.toISOString(),
      keywords: conversation.keywords,
    }));
  }

  /**
   * Updated `findRelatedConversation` to incorporate a vector-similarity approach
   * while still keeping your old logic for references, mentions, participants, keywords, etc.
   */
  private findRelatedConversation(
    message: DiscordMessageWithEmbedding,
    displayName: string,
    referencedMessageId?: string,
  ): Conversation | null {
    const messageKeywords = this.extractKeywords(message.content);
    const messageEmbedding = message.cleanContentEmbedding;

    // 1. Check if the new message directly references a message within an existing conversation
    const referencedConversation = referencedMessageId
      ? this.conversations.find((conv) =>
        conv.messages.some((msg) => msg.id === referencedMessageId)
      )
      : null;
    if (referencedConversation) {
      return referencedConversation;
    }

    // 2. Evaluate each conversation for potential match
    let bestMatch: Conversation | null = null;
    let bestScore = -1;

    for (const conv of this.conversations) {
      // For convenience, check the existing participant logic, mention overlap, etc.
      const isParticipantRelated = conv.participants.includes(displayName) ||
        message.mentions.users.some((user) =>
          conv.participants.includes(user.username)
        );

      const hasMentionOverlap = conv.messages.some((msg) =>
        msg.mentions.users.some((mention: { id: string }) =>
          message.mentions.users.some((user) => user.id === mention.id)
        )
      );

      const hasKeywordOverlap = (conv.keywords ?? []).some((keyword) =>
        messageKeywords.includes(keyword)
      );

      const isWithinTimeThreshold = Math.abs(
        message.createdTimestamp - conv.lastActive.getTime(),
      ) < this.stalenessThreshold;

      // 3. Combine old logic with vector similarity
      // We only bother if there's at least some "overlap" or the conversation isn't stale.
      if (
        (isParticipantRelated || hasMentionOverlap || hasKeywordOverlap) &&
        isWithinTimeThreshold &&
        messageEmbedding &&
        conv.conversationEmbedding
      ) {
        const sim = this.cosineSimilarity(
          messageEmbedding,
          conv.conversationEmbedding,
        );
        if (sim > bestScore) {
          bestScore = sim;
          bestMatch = conv;
        }
      }
    }

    // 4. If the best match is above some threshold, return it. Otherwise, null => new conversation.
    if (bestScore >= this.SIMILARITY_THRESHOLD) {
      return bestMatch;
    }
    return null;
  }

  /**
   * Assign the new message to an existing conversation. Also re-average
   * the conversation’s embedding if the new message has an embedding.
   */
  private assignMessageToConversation(
    conversation: Conversation,
    message: DiscordMessageWithEmbedding,
    messageKeywords: string[],
    displayName: string,
  ): void {
    conversation.messages.push(message);
    conversation.messageCount += 1;
    conversation.lastActive = new Date(message.createdTimestamp);

    // Add author to participants if not present
    if (!conversation.participants.includes(displayName)) {
      conversation.participants.push(displayName);
    }

    // Add mentioned users to participants
    message.mentions.users.forEach((user) => {
      if (!conversation.participants.includes(user.username)) {
        conversation.participants.push(user.username);
      }
    });

    // Update keywords
    conversation.keywords = Array.from(
      new Set([...(conversation.keywords || []), ...messageKeywords]),
    );

    // Recompute conversation embedding by averaging with the new message embedding
    if (message.cleanContentEmbedding) {
      conversation.conversationEmbedding = this.averageEmbeddings(
        conversation.conversationEmbedding,
        message.cleanContentEmbedding,
        conversation.messageCount,
      );
    }
  }

  /**
   * Create a new conversation from a message. If the message has an embedding,
   * initialize the conversation's embedding with it.
   */
  private startNewConversation(
    message: DiscordMessageWithEmbedding,
    messageKeywords: string[],
    displayName: string,
  ): void {
    const newConversation: Conversation = {
      id: this.conversationIdCounter++,
      messageCount: 1,
      messages: [message],
      participants: [displayName],
      startTime: new Date(message.createdTimestamp),
      lastActive: new Date(message.createdTimestamp),
      keywords: messageKeywords,
      conversationEmbedding: message.cleanContentEmbedding ?? undefined,
    };
    this.conversations.push(newConversation);
    this.messageIdToConversationId[message.id] = newConversation.id;
  }

  /**
   * A simple keyword-extraction approach using `natural.WordTokenizer`.
   * Feel free to expand or replace for your own tokenization / keyword logic.
   */
  private extractKeywords(content: string): string[] {
    const tokenizer = new natural.WordTokenizer();
    const tokens = tokenizer.tokenize(content);
    return tokens
      .map((word) => word.toLowerCase())
      .filter((word) => word.length > 3 && !natural.stopwords.includes(word));
  }

  /**
   * Returns the list of conversations, sorted by most recent `lastActive`.
   */
  public getConversations(): Conversation[] {
    return this.conversations.sort(
      (a, b) => b.lastActive.getTime() - a.lastActive.getTime(),
    );
  }

  /**
   * Helper to fetch an embedding for a single text using your existing getEmbeddingBatch().
   * This is a minimal wrapper; you could also do in-line calls if you prefer.
   */
  private async embedNewMessage(text: string): Promise<number[] | null> {
    // Reuse your getEmbeddingBatch function or similar.
    // For single text, we can pass an array of length 1.
    const [embedding] = await getEmbeddingBatch([text]);
    return embedding;
  }

  /**
   * Utility to average embeddings for conversation-level representation.
   * Weighted by the new item count so that each message counts equally.
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
   */
  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    const dot = vec1.reduce((acc, val, i) => acc + val * vec2[i], 0);
    const normA = Math.sqrt(vec1.reduce((acc, val) => acc + val * val, 0));
    const normB = Math.sqrt(vec2.reduce((acc, val) => acc + val * val, 0));
    return dot / (normA * normB);
  }
}

/**
 * Example usage of your conversation manager with a batch of messages.
 * (You already had something similar in your code.)
 */
export async function processMessages(
  messages: Message<true>[],
  conversationManager: ConversationManager,
) {
  await Promise.all(
    messages.map((message) =>
      conversationManager.addMessageToConversations(message)
    ),
  );
}

/**
 * The function that calls the OpenAI Embedding API to batch-embed texts.
 * This matches your original code snippet, adapted to be used above.
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
