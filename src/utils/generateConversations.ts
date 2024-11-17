// deriveConversations.ts

import type { Guild } from "discord.js";
import { getFiresideMessages } from "../lib/discord/discord.ts";
import type { Conversation } from "../types.ts";
import * as fs from "fs";
import pLimit from "p-limit";

export async function generateConversations(
  guild: Guild,
): Promise<Conversation[]> {
  const conversations: Conversation[] = [];
  let conversationIdCounter = 0;
  const timeThreshold = 5 * 60 * 1000; // 5 minutes
  const similarityThreshold = 0.75; // Adjusted threshold

  const messages = await getFiresideMessages(guild);
  const sortedMessages = messages.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const limit = pLimit(5); // Limit concurrent API calls

  // Generate embeddings for each message in batches
  const batchSize = 20; // Adjust batch size as needed
  const batchedMessages = [];

  for (let i = 0; i < sortedMessages.length; i += batchSize) {
    batchedMessages.push(sortedMessages.slice(i, i + batchSize));
  }

  for (const batch of batchedMessages) {
    console.log(
      `Processing batch starting at message timestamp ${batch[0].timestamp}`,
    );
    await limit(async () => {
      const texts = batch.map((message) =>
        message.messageContent?.trim() || ""
      );
      const embeddings = await getEmbeddingBatch(texts);

      embeddings.forEach((embedding, index) => {
        batch[index].embedding = embedding;
      });
    });
  }

  // Assign messages to conversations based on time and similarity
  for (const message of sortedMessages) {
    // Skip messages without embeddings
    if (!message.embedding) {
      continue;
    }

    let assigned = false;

    for (const conv of conversations) {
      const timeDiff = new Date(message.timestamp).getTime() -
        new Date(conv.startTime).getTime();

      if (timeDiff < timeThreshold) {
        // Compare message embedding with conversation's first message embedding
        const similarity = cosineSimilarity(
          message.embedding,
          conv.conversationEmbedding!,
        );

        console.log(
          `Similarity between message at ${message.timestamp} and conversation ID ${conv.id}: ${
            similarity.toFixed(2)
          }`,
        );

        if (similarity > similarityThreshold) {
          // Assign message to this conversation
          conv.messages.push(message);
          if (!conv.participants.includes(message.displayName)) {
            conv.participants.push(message.displayName);
          }
          // Do not update conversationEmbedding
          conv.lastActive = new Date(message.timestamp);
          assigned = true;
          break;
        }
      }
    }

    if (!assigned) {
      // Create new conversation
      const newConversation: Conversation = {
        id: conversationIdCounter++,
        messages: [message],
        participants: [message.displayName],
        startTime: new Date(message.timestamp),
        lastActive: new Date(message.timestamp),
        conversationEmbedding: message.embedding.slice(), // Use first message embedding
      };
      conversations.push(newConversation);
      console.log(
        `Created new conversation ID ${newConversation.id} for message by ${message.displayName} at ${message.timestamp}`,
      );
    }
  }

  // Sort messages in each conversation from first to last
  conversations.forEach((conv) => {
    conv.messages.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  });

  // Remove embeddings before saving or returning
  const conversationsWithoutEmbeddings = conversations.map((conv) => ({
    ...conv,
    messages: conv.messages.map(({ embedding, ...rest }) => rest),
    conversationEmbedding: undefined,
  }));

  // Save the conversations to a JSON file
  const json = JSON.stringify(conversationsWithoutEmbeddings, null, 2);
  fs.writeFileSync("./logs/conversations.json", json);
  console.log("Conversations successfully derived and saved.");
  return conversations;
}

// Updated getEmbeddingBatch function
async function getEmbeddingBatch(
  texts: string[],
  retryCount = 0,
): Promise<(number[] | null)[]> {
  // Filter out invalid texts
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
        // Rate limit exceeded, retry with backoff
        const waitTime = Math.pow(2, retryCount) * 1000;
        console.log(`Rate limit hit. Retrying in ${waitTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return await getEmbeddingBatch(texts, retryCount + 1);
      }

      return texts.map(() => null);
    }

    const data = await response.json();

    const embeddings = data.data.map((item: any) => item.embedding);

    // Map back embeddings to original texts
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
