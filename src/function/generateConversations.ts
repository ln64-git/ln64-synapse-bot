// deriveConversations.ts

import type { Guild, Message } from "discord.js";
import { getFiresideMessages } from "../lib/discord/discord.ts";
import type { Conversation } from "../types.ts";
import * as fs from "fs";
import pLimit from "p-limit";

export async function generateConversations(
  messages: Message<true>[],
): Promise<Conversation[]> {
  if (!Array.isArray(messages) || messages.length === 0) {
    console.warn("No messages to process.");
    console.log("Messages type:", typeof messages);
    return [];
  }

  // console.log("Processing messages in generateConversations:", messages);
  const conversations: Conversation[] = [];
  let conversationIdCounter = 0;
  const timeThreshold = 5 * 60 * 1000; // 5 minutes
  const similarityThreshold = 0.75; // Adjusted threshold

  const sortedMessages = messages.sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp,
  );

  // Create mappings for quick lookups
  const messageIdToMessage: { [key: string]: Message<true> } = {};
  const messageIdToConversationId: { [key: string]: number } = {};

  sortedMessages.forEach((message) => {
    messageIdToMessage[message.id] = message;
  });

  const limit = pLimit(5); // Limit concurrent API calls

  // Generate embeddings for each message in batches
  const batchSize = 20; // Adjust batch size as needed
  const batchedMessages: Message<true>[][] = [];

  for (let i = 0; i < sortedMessages.length; i += batchSize) {
    batchedMessages.push(sortedMessages.slice(i, i + batchSize));
  }

  // Map to store embeddings
  const messageEmbeddings: { [key: string]: number[] | null } = {};

  for (const batch of batchedMessages) {
    console.log(
      `Processing batch starting at message timestamp ${
        batch[0].createdAt.toISOString()
      }`,
    );
    await limit(async () => {
      const texts = batch.map((message) => message.content?.trim() || "");
      const embeddings = await getEmbeddingBatch(texts);

      embeddings.forEach((embedding, index) => {
        const messageId = batch[index].id;
        messageEmbeddings[messageId] = embedding;
      });
    });
  }

  // Assign messages to conversations based on replies, mentions, time, and similarity
  for (const message of sortedMessages) {
    const embedding = messageEmbeddings[message.id];
    // Skip messages without embeddings
    if (!embedding) {
      continue;
    }

    let assigned = false;

    // Get displayName
    const displayName = message.member?.displayName || message.author.username;

    // Check if message is a reply to another message
    const referencedMessageId = message.reference?.messageId || null;
    if (referencedMessageId) {
      const referencedMessage = messageIdToMessage[referencedMessageId];
      if (referencedMessage) {
        const conversationId = messageIdToConversationId[referencedMessageId];
        if (conversationId !== undefined) {
          // Add the current message to the same conversation, regardless of timeframe
          const conv = conversations.find((c) => c.id === conversationId)!;
          conv.messages.push(message);
          if (!conv.participants.includes(displayName)) {
            conv.participants.push(displayName);
          }
          conv.lastActive = message.createdAt;
          messageIdToConversationId[message.id] = conversationId;
          assigned = true;
          console.log(
            `Assigned message by ${displayName} at ${message.createdAt.toISOString()} to conversation ID ${conv.id} (reply to message in same conversation)`,
          );
        } else {
          // Referenced message is not in a conversation, create new conversation with both messages
          const refDisplayName = referencedMessage.member?.displayName ||
            referencedMessage.author.username;

          let conversationEmbedding = messageEmbeddings[referencedMessageId];
          if (!conversationEmbedding) {
            console.warn(
              `Embedding for referenced message ID ${referencedMessageId} is undefined. Using current message's embedding.`,
            );
            conversationEmbedding = embedding;
          }

          const newConversation: Conversation = {
            id: conversationIdCounter++,
            messages: [referencedMessage, message],
            participants: [refDisplayName, displayName],
            startTime: referencedMessage.createdAt,
            lastActive: message.createdAt,
            conversationEmbedding: conversationEmbedding.slice(),
          };
          conversations.push(newConversation);
          messageIdToConversationId[referencedMessageId] = newConversation.id;
          messageIdToConversationId[message.id] = newConversation.id;
          assigned = true;
          console.log(
            `Created new conversation ID ${newConversation.id} for message by ${displayName} at ${message.createdAt.toISOString()} (reply to message not in any conversation)`,
          );
        }
      } else {
        console.log(
          `Referenced message by ${displayName} at ${message.createdAt.toISOString()} not found. Proceeding to assign based on mentions, time, and similarity.`,
        );
      }
    }

    if (!assigned && message.mentions.users.size > 0) {
      const mentionDisplayNames = message.mentions.users.map((user) => {
        const member = message.guild?.members.cache.get(user.id);
        return member?.displayName || user.username;
      });

      for (const conv of conversations) {
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
          messageIdToConversationId[message.id] = conv.id;
          assigned = true;
          console.log(
            `Assigned message by ${displayName} at ${message.createdAt.toISOString()} to conversation ID ${conv.id} (mentions participant)`,
          );
          break;
        }
      }

      if (!assigned) {
        const newConversation: Conversation = {
          id: conversationIdCounter++,
          messages: [message],
          participants: [displayName, ...mentionDisplayNames],
          startTime: message.createdAt,
          lastActive: message.createdAt,
          conversationEmbedding: embedding.slice(),
        };
        conversations.push(newConversation);
        messageIdToConversationId[message.id] = newConversation.id;
        assigned = true;
        console.log(
          `Created new conversation ID ${newConversation.id} for message by ${displayName} at ${message.createdAt.toISOString()} (mentions)`,
        );
      }
    }

    if (!assigned) {
      for (const conv of conversations) {
        const timeDiff = message.createdTimestamp - conv.startTime.getTime();
        if (timeDiff < timeThreshold) {
          const similarity = cosineSimilarity(
            embedding,
            conv.conversationEmbedding!,
          );
          console.log(
            `Similarity between message at ${message.createdAt.toISOString()} and conversation ID ${conv.id}: ${
              similarity.toFixed(2)
            }`,
          );

          if (similarity > similarityThreshold) {
            conv.messages.push(message);
            if (!conv.participants.includes(displayName)) {
              conv.participants.push(displayName);
            }
            conv.lastActive = message.createdAt;
            messageIdToConversationId[message.id] = conv.id;
            assigned = true;
            console.log(
              `Assigned message by ${displayName} at ${message.createdAt.toISOString()} to conversation ID ${conv.id} (similarity)`,
            );
            break;
          }
        }
      }
    }

    if (!assigned) {
      const newConversation: Conversation = {
        id: conversationIdCounter++,
        messages: [message],
        participants: [displayName],
        startTime: message.createdAt,
        lastActive: message.createdAt,
        conversationEmbedding: embedding.slice(),
      };
      conversations.push(newConversation);
      messageIdToConversationId[message.id] = newConversation.id;
      console.log(
        `Created new conversation ID ${newConversation.id} for message by ${displayName} at ${message.createdAt.toISOString()}`,
      );
    }
  }

  conversations.forEach((conv) => {
    conv.messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  });

  const conversationsWithoutEmbeddings = conversations.map((conv) => ({
    ...conv,
    messages: conv.messages.map((message) => {
      const displayName = message.member?.displayName ||
        message.author.username;
      return {
        id: message.id,
        content: message.content,
        author: displayName,
        timestamp: message.createdAt.toISOString(),
      };
    }),
    conversationEmbedding: undefined,
  }));

  const json = JSON.stringify(conversationsWithoutEmbeddings, null, 2);
  fs.writeFileSync("./logs/conversations.json", json);
  console.log("Conversations successfully derived and saved.");
  return conversations;
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

function cosineSimilarity(vecA: number[], vecB: number[]): number {
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
