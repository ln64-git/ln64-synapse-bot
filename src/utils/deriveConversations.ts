// deriveConversations.ts

import { callModel } from "../lib/langchain/model.ts";
import type { Conversation, FiresideMessage } from "../types.ts";

// Ensure performOCR is defined or imported
async function performOCR(imageUrl: string): Promise<string> {
  try {
    const response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: {
        apikey: process.env.OCR_API_KEY || "",
      },
      body: new URLSearchParams({ url: imageUrl }),
    });

    if (!response.ok) {
      console.error("OCR API error:", response.statusText);
      return "";
    }

    const data = await response.json();
    return data.ParsedResults?.[0]?.ParsedText || "";
  } catch (error) {
    console.error("Error performing OCR:", error);
    return "";
  }
}

export async function deriveConversations(
  messages: FiresideMessage[],
): Promise<Conversation[]> {
  const sortedMessages = messages;

  // Process attachments and generate summaries/OCR text
  for (const message of sortedMessages) {
    // Check if message has attachments and either no content or empty content
    if (
      (!message.messageContent ||
        message.messageContent.trim() === "" ||
        (message.messageContent &&
          extractImageUrls(message.messageContent).length > 0)) &&
      message.attachments &&
      message.attachments.length > 0
    ) {
      for (const attachment of message.attachments) {
        if (attachment.url && isImageUrl(attachment.url)) {
          console.log(`Processing attachment URL: ${attachment.url}`);

          // Generate summary using LangChain
          const summaryPrompt =
            `Provide a concise summary for the following image URL: ${attachment.url}`;
          try {
            attachment.summary = await callModel(summaryPrompt);
            console.log(
              `Generated summary for attachment: ${attachment.summary}`,
            );
          } catch (error) {
            console.error(
              `Error generating summary for ${attachment.url}:`,
              error,
            );
            attachment.summary = "";
          }

          // Perform OCR to extract text from the image
          try {
            attachment.ocrText = await performOCR(attachment.url);
            console.log(
              `Extracted OCR text for attachment: ${attachment.ocrText}`,
            );
          } catch (error) {
            console.error(`Error performing OCR for ${attachment.url}:`, error);
            attachment.ocrText = "";
          }
        } else {
          console.log(`URL is not recognized as an image: ${attachment.url}`);
        }
      }
    }

    // Generate embedding based on message content or attachment summaries
    if (message.messageContent && message.messageContent.trim() !== "") {
      console.log(
        `Generating embedding for message content: "${message.messageContent}"`,
      );
      message.embedding = await getEmbedding(message.messageContent);
    } else if (message.attachments && message.attachments.length > 0) {
      // Concatenate all attachment summaries and OCR texts for embedding
      const combinedText = message.attachments.map((att) =>
        att.summary || ""
      ).join(" ") +
        " " +
        message.attachments.map((att) => att.ocrText || "").join(" ");
      console.log(
        `Generating embedding for combined attachment data: "${combinedText.trim()}"`,
      );
      message.embedding = await getEmbedding(combinedText.trim());
    } else {
      // Default embedding if no content or attachments
      console.warn(
        `No content or attachments found for message by ${message.displayName} at ${message.timestamp}. Using zero vector.`,
      );
      message.embedding = Array(1536).fill(0);
    }
  }

  const conversations: Conversation[] = [];
  let conversationIdCounter = 0;
  const timeThreshold = 5 * 60 * 1000; // 5 minutes
  const similarityThreshold = 0.7; // Adjust as needed

  for (const message of sortedMessages) {
    let assigned = false;

    for (const conv of conversations) {
      const timeDiff = new Date(message.timestamp).getTime() -
        conv.lastActive.getTime();

      if (timeDiff < timeThreshold) {
        // Compare message embedding with conversation embedding
        const similarity = cosineSimilarity(
          message.embedding,
          conv.conversationEmbedding!,
        );

        if (similarity > similarityThreshold) {
          // Assign message to this conversation
          conv.messages.push(message);
          if (!conv.participants.includes(message.displayName)) {
            conv.participants.push(message.displayName);
          }
          conv.lastActive = new Date(message.timestamp);

          // Update embedding sum
          conv.embeddingSum = addEmbeddings(
            conv.embeddingSum!,
            message.embedding,
          );

          // Recompute conversation embedding (average)
          conv.conversationEmbedding = divideEmbedding(
            conv.embeddingSum,
            conv.messages.length,
          );

          console.log(
            `Assigned message by ${message.displayName} at ${message.timestamp} to conversation ID ${conv.id}`,
          );
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
        lastActive: new Date(message.timestamp),
        conversationEmbedding: message.embedding.slice(), // Copy of the embedding
        embeddingSum: message.embedding.slice(), // Start sum with this embedding
      };
      conversations.push(newConversation);
      console.log(
        `Created new conversation ID ${newConversation.id} for message by ${message.displayName} at ${message.timestamp}`,
      );
    }
  }

  // Remove embeddings before saving or returning
  const conversationsWithoutEmbeddings = conversations.map((conv) => ({
    ...conv,
    messages: conv.messages.map(({ embedding, ...rest }) => rest),
    conversationEmbedding: undefined,
    embeddingSum: undefined,
  }));

  // Save the conversations to a JSON file
  const encoder = new TextEncoder();
  const json = JSON.stringify(conversationsWithoutEmbeddings, null, 2);
  const fs = require('fs');
  fs.writeFileSync("./logs/conversations.json", json);

  console.log("Conversations successfully derived and saved.");
  return conversations;
}

// Utility Functions

function addEmbeddings(embeddingA: number[], embeddingB: number[]): number[] {
  return embeddingA.map((val, idx) => val + embeddingB[idx]);
}

function divideEmbedding(embedding: number[], divisor: number): number[] {
  return embedding.map((val) => val / divisor);
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

// Reuse the updated isImageUrl function
function isImageUrl(url: string): boolean {
  const imageExtensions = [
    ".jpeg",
    ".jpg",
    ".gif",
    ".png",
    ".bmp",
    ".webp",
    ".tiff",
  ];
  const imageProviders = ["tenor.com", "giphy.com", "imgur.com"];

  // Check for image file extensions
  if (imageExtensions.some((ext) => url.toLowerCase().includes(ext))) {
    return true;
  }

  // Check for known image provider domains
  if (imageProviders.some((provider) => url.toLowerCase().includes(provider))) {
    return true;
  }

  return false;
}

// Ensure getEmbedding is correctly imported or defined
async function getEmbedding(text: string): Promise<number[]> {
  // Handle empty text
  if (!text.trim() || /https?:\/\/\S+/.test(text)) {
    console.warn("Empty or URL-containing message; returning zero vector.");
    return Array(1536).fill(0);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        input: text,
        model: "text-embedding-ada-002",
      }),
    });

    if (!response.ok) {
      console.error("Embedding API error:", response.statusText);
      return Array(1536).fill(0);
    }

    const data = await response.json();

    if (data && data.data && data.data[0] && data.data[0].embedding) {
      return data.data[0].embedding;
    } else {
      console.error("Invalid embedding response format:", data);
      return Array(1536).fill(0);
    }
  } catch (error) {
    console.error("Error fetching embedding:", error);
    return Array(1536).fill(0);
  }
}

function extractUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.match(urlRegex) || [];
}

function extractImageUrls(text: string): string[] {
  const urls = extractUrls(text);
  return urls.filter((url) => isImageUrl(url));
}
