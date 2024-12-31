import type { Message } from "discord.js";
import type { Conversation } from "../types/types.ts";
import natural from "natural";

export class ConversationManager {
  private conversations: Conversation[] = [];
  private messageIdToConversationId: { [key: string]: number } = {};
  private conversationIdCounter = 0;
  private stalenessThreshold = 10 * 60 * 1000; // 10 minutes for temporal proximity

  constructor() {}

  public async addMessageToConversations(
    message: Message<true>,
  ): Promise<void> {
    const displayName = message.member?.displayName || message.author.username;
    const referencedMessageId = message.reference?.messageId;
    const messageKeywords = this.extractKeywords(message.content);

    const relatedConversation = this.findRelatedConversation(
      message,
      displayName,
      referencedMessageId,
    );

    if (relatedConversation) {
      this.assignMessageToConversation(
        relatedConversation,
        message,
        messageKeywords,
        displayName,
      );
    } else {
      this.startNewConversation(message, messageKeywords, displayName);
    }
  }

  public getFormattedConversations(): object[] {
    return this.getConversations().map((conversation) => ({
      id: conversation.id,
      messageCount: conversation.messageCount,
      messages: conversation.messages.map((msg) => ({
        timestamp: msg.createdTimestamp,
        server: msg.guild.name,
        channel: msg.channel.name,
        message: {
          content: msg.content,
          author: msg.author.username,
          attachments: msg.attachments.map((att) => att.url),
          mentions: msg.mentions.users.map((user) => user.username),
        },
      })),
      participants: conversation.participants,
      startTime: conversation.startTime.toISOString(),
      lastActive: conversation.lastActive.toISOString(),
      keywords: conversation.keywords,
    }));
  }

  private findRelatedConversation(
    message: Message<true>,
    displayName: string,
    referencedMessageId?: string,
  ): Conversation | null {
    // Check for referenced messages
    const referencedConversation = referencedMessageId
      ? this.conversations.find((conv) =>
        conv.messages.some((msg) => msg.id === referencedMessageId)
      )
      : null;

    if (referencedConversation) {
      return referencedConversation;
    }

    // Check for relationships based on mentions or participants
    return this.conversations.find((conv) => {
      const isParticipantRelated = conv.participants.includes(displayName) ||
        message.mentions.users.some((user) =>
          conv.participants.includes(user.username)
        );

      const hasMentionOverlap = conv.messages.some((msg) =>
        msg.mentions.users.some((mention) =>
          message.mentions.users.some((user) => user.id === mention.id)
        )
      );

      // Relax time threshold for strong mention relationships
      const isWithinTimeThreshold =
        Math.abs(message.createdTimestamp - conv.lastActive.getTime()) <
          this.stalenessThreshold;

      return isParticipantRelated || hasMentionOverlap || isWithinTimeThreshold;
    }) || null;
  }

  private assignMessageToConversation(
    conversation: Conversation,
    message: Message<true>,
    messageKeywords: string[],
    displayName: string,
  ): void {
    conversation.messages.push(message);
    conversation.messageCount += 1;
    conversation.lastActive = new Date(message.createdTimestamp);

    // Add author to participants
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
  }

  private startNewConversation(
    message: Message<true>,
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
    };
    this.conversations.push(newConversation);
    this.messageIdToConversationId[message.id] = newConversation.id;
  }

  private extractKeywords(content: string): string[] {
    const tokenizer = new natural.WordTokenizer();
    const tokens = tokenizer.tokenize(content);
    return tokens
      .map((word) => word.toLowerCase())
      .filter((word) => word.length > 3 && !natural.stopwords.includes(word));
  }

  public getConversations(): Conversation[] {
    return this.conversations.sort(
      (a, b) => b.lastActive.getTime() - a.lastActive.getTime(),
    );
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
