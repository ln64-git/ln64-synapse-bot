import type { Message } from "discord.js";
import type { Conversation } from "../types/types.ts";
import pLimit from "p-limit";
import natural, { TfIdf } from "natural";
import { NlpManager } from "node-nlp"; // Add node-nlp for simple NER

export class ConversationManager {
  private conversations: Conversation[] = [];
  private messageIdToConversationId: { [key: string]: number } = {};
  private conversationIdCounter = 0;
  private stalenessThreshold = 15 * 60 * 1000; // 15 minutes for stale conversations

  constructor() {}

  public async addMessageToConversations(
    message: Message<true>,
  ): Promise<void> {
    const displayName = message.member?.displayName || message.author.username;
    const referencedMessageId = message.reference?.messageId;

    // Generate keywords for the message
    const messageKeywords = this.extractKeywords(message.content);

    // Handle direct replies
    if (
      referencedMessageId &&
      this.messageIdToConversationId[referencedMessageId] !== undefined
    ) {
      const convId = this.messageIdToConversationId[referencedMessageId];
      const conv = this.conversations.find((c) => c.id === convId)!;
      this.assignMessageToConversation(
        conv,
        message,
        messageKeywords,
        displayName,
      );
      return;
    }

    // Find an existing conversation by keyword similarity
    const existingConversation = this.findExistingConversationByKeywords(
      messageKeywords,
    );

    if (existingConversation) {
      this.assignMessageToConversation(
        existingConversation,
        message,
        messageKeywords,
        displayName,
      );
      return;
    }

    // Start a new conversation
    this.startNewConversation(message, messageKeywords, displayName);
  }

  private findExistingConversationByKeywords(
    keywords: string[],
  ): Conversation | null {
    return this.conversations.find((conv) => {
      // Skip stale conversations
      if (Date.now() - conv.lastActive.getTime() > this.stalenessThreshold) {
        return false;
      }

      // Calculate keyword overlap
      const overlap = keywords.filter((keyword) =>
        conv.keywords?.includes(keyword)
      );
      const overlapRatio = overlap.length /
        Math.max(keywords.length, conv.keywords?.length ?? 0);

      return overlapRatio > 0.5; // Threshold for keyword similarity (adjust as needed)
    }) || null;
  }

  private assignMessageToConversation(
    conv: Conversation,
    message: Message<true>,
    messageKeywords: string[],
    displayName: string,
  ) {
    conv.messages.push(message);

    // Increment the message count
    conv.messageCount += 1;

    // Add the participant if not already present
    if (!conv.participants.includes(displayName)) {
      conv.participants.push(displayName);
    }

    // Update the last active timestamp
    conv.lastActive = message.createdAt;

    // Merge the message's keywords into the conversation's keywords
    conv.keywords = Array.from(
      new Set([...(conv.keywords || []), ...messageKeywords]),
    );

    // Map the message ID to the conversation ID
    this.messageIdToConversationId[message.id] = conv.id;
  }

  private startNewConversation(
    message: Message<true>,
    messageKeywords: string[],
    displayName: string,
  ) {
    const newConversation: Conversation = {
      id: this.conversationIdCounter++,
      messageCount: 1, // Initialize messageCount
      messages: [message],
      participants: [displayName],
      startTime: message.createdAt,
      lastActive: message.createdAt,
      keywords: messageKeywords,
    };

    this.conversations.push(newConversation);
    this.messageIdToConversationId[message.id] = newConversation.id;
  }

  private extractKeywords(content: string): string[] {
    // Tokenize the content
    const tokenizer = new natural.WordTokenizer();
    const tokens = tokenizer.tokenize(content);

    // Filter tokens to include only meaningful words
    const filteredTokens = tokens
      .map((word) => word.toLowerCase())
      .filter((word) => word.length > 3 && !natural.stopwords.includes(word));

    // Remove duplicates
    return Array.from(new Set(filteredTokens));
  }

  public getConversations(): Conversation[] {
    return this.conversations;
  }
}

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
