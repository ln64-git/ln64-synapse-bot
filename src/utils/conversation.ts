import {
    Collection,
    Guild,
    Message,
    type Snowflake,
    TextChannel,
} from "discord.js";
import * as fs from "fs/promises";
import DBSCAN from "density-clustering";

// Define the structure of a FiresideMessage
type FiresideMessage = {
    displayName: string;
    message: string;
    timestamp: string;
    embedding: number[];
};

// Define the structure of a Conversation
type Conversation = {
    id: number;
    messages: FiresideMessage[];
    participants: Set<string>;
    lastActive: Date;
    conversationEmbedding: number[];
    embeddingSum: number[];
};

// Logging Levels
enum LogLevel {
    INFO,
    DEBUG,
    ERROR,
}

const CURRENT_LOG_LEVEL = LogLevel.DEBUG;

function log(message: string, level: LogLevel = LogLevel.INFO): void {
    if (level >= CURRENT_LOG_LEVEL) {
        console.log(message);
    }
}

const embeddingCache: Map<string, number[]> = new Map();

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
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

function addEmbeddings(embeddingA: number[], embeddingB: number[]): number[] {
    return embeddingA.map((val, idx) => val + embeddingB[idx]);
}

function divideEmbedding(embedding: number[], divisor: number): number[] {
    return embedding.map((val) => val / divisor);
}

function averageEmbedding(embeddings: number[][]): number[] {
    const sum = embeddings.reduce(
        (acc, vec) => acc.map((val, idx) => val + vec[idx]),
        Array(embeddings[0].length).fill(0),
    );
    return sum.map((val) => val / embeddings.length);
}

async function getEmbeddingWithCache(text: string): Promise<number[]> {
    if (embeddingCache.has(text)) {
        return embeddingCache.get(text)!;
    }
    const embedding = await getEmbedding(text);
    embeddingCache.set(text, embedding);
    return embedding;
}

async function getEmbedding(text: string): Promise<number[]> {
    // Handle empty or non-informative text
    if (!text.trim() || text.length < 3) { // Adjust the length threshold as needed
        log(
            "Non-informative message content; returning zero vector.",
            LogLevel.DEBUG,
        );
        return Array(1536).fill(0); // Assuming the embedding size is 1536
    }

    try {
        const response = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                input: text,
                model: "text-embedding-ada-002",
            }),
        });

        if (!response.ok) {
            log(`Embedding API error: ${response.statusText}`, LogLevel.ERROR);
            return Array(1536).fill(0);
        }

        const data = await response.json();

        if (data && data.data && data.data[0] && data.data[0].embedding) {
            return data.data[0].embedding;
        } else {
            log("Invalid embedding response format.", LogLevel.ERROR);
            return Array(1536).fill(0);
        }
    } catch (error) {
        log(`Error fetching embedding: ${error}`, LogLevel.ERROR);
        return Array(1536).fill(0);
    }
}

async function getFiresideMessages(
    guild: Guild,
): Promise<FiresideMessage[]> {
    const channelId = process.env.CHANNEL_ID;
    if (!channelId) {
        throw new Error("CHANNEL_ID is not set in environment variables.");
    }

    const channel = guild.channels.resolve(channelId) as TextChannel;
    if (!channel) {
        throw new Error(`Channel with ID ${channelId} not found.`);
    }

    // Fetch messages; adjust the limit as needed for context
    const fetchedMessages: Collection<Snowflake, Message<true>> = await channel
        .messages.fetch({ limit: 100 }); // Increase limit as needed

    // Convert Collection to an array and map to FiresideMessage
    const messagesArray: Message<true>[] = Array.from(fetchedMessages.values());

    const firesideMessages: FiresideMessage[] = messagesArray
        .map((message) => ({
            displayName: message.member?.displayName || message.author.username,
            message: message.content,
            timestamp: message.createdAt.toISOString(),
            embedding: [], // To be filled later
        }))
        .filter((msg) => msg.message.trim().length >= 3); // Filter out short/non-informative messages

    // Sort messages chronologically
    const sortedMessages = firesideMessages.sort(
        (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    // Save sorted messages to a JSON file for debugging
    const encoder = new TextEncoder();
    const json = JSON.stringify(sortedMessages, null, 2);
    const fs = require("fs").promises;
    await fs.writeFile("./log/messages.json", encoder.encode(json));

    return sortedMessages;
}

async function clusterConversations(
    messages: FiresideMessage[],
): Promise<Conversation[]> {
    const vectors = messages.map((msg) => msg.embedding);

    // Initialize DBSCAN
    const dbscan = new DBSCAN.DBSCAN();
    const eps = 0.7; // Adjust based on experimentation
    const minPts = 2;

    log("Running DBSCAN clustering...", LogLevel.INFO);
    const clusters = dbscan.run(vectors, eps, minPts);
    const noise = dbscan.noise;

    log(
        `Found ${clusters.length} clusters and ${noise.length} noise points.`,
        LogLevel.INFO,
    );

    const conversations: Conversation[] = clusters.map((
        cluster: number[],
        index: number,
    ) => ({
        id: index,
        messages: cluster.map((i) => messages[i]),
        participants: new Set(cluster.map((i) => messages[i].displayName)),
        lastActive: new Date(
            Math.max(
                ...cluster.map((i) =>
                    new Date(messages[i].timestamp).getTime()
                ),
            ),
        ),
        conversationEmbedding: averageEmbedding(
            cluster.map((i) => messages[i].embedding),
        ),
        embeddingSum: [], // Optional
    }));

    // Handle noise points by creating separate conversations
    noise.forEach((i: number, idx: number) => {
        const noiseMessage = messages[i];
        conversations.push({
            id: clusters.length + idx,
            messages: [noiseMessage],
            participants: new Set([noiseMessage.displayName]),
            lastActive: new Date(noiseMessage.timestamp),
            conversationEmbedding: noiseMessage.embedding.slice(),
            embeddingSum: noiseMessage.embedding.slice(),
        });
    });

    // Sort conversations by lastActive
    conversations.sort((a, b) =>
        a.lastActive.getTime() - b.lastActive.getTime()
    );

    // Exclude embeddings before saving
    const conversationsToSave = conversations.map((conv) => ({
        id: conv.id,
        messages: conv.messages.map(({ embedding, ...rest }) => rest),
        participants: Array.from(conv.participants),
        lastActive: conv.lastActive.toISOString(),
    }));

    // Save to JSON for debugging
    try {
        const encoder = new TextEncoder();
        const json = JSON.stringify(conversationsToSave, null, 2);
        await fs.writeFile(
            "./log/conversations_clustered.json",
            json,
        );
        log(
            "Clustered conversations saved to ./log/conversations_clustered.json",
            LogLevel.INFO,
        );
    } catch (error) {
        log(
            `Error writing clustered conversations to file: ${error}`,
            LogLevel.ERROR,
        );
    }

    log(`Total conversations derived: ${conversations.length}`, LogLevel.INFO);
    return conversations;
}

function refineClustersByTime(
    conversations: Conversation[],
    timeGapMinutes: number = 10,
): Conversation[] {
    const refined: Conversation[] = [];
    const timeThreshold = timeGapMinutes * 60 * 1000; // 10 minutes

    conversations.forEach((conv) => {
        if (conv.messages.length === 0) return;

        let currentConv: Conversation = {
            ...conv,
            messages: [conv.messages[0]],
            participants: new Set([conv.messages[0].displayName]),
            lastActive: new Date(conv.messages[0].timestamp),
            conversationEmbedding: conv.conversationEmbedding.slice(),
            embeddingSum: conv.embeddingSum.slice(),
        };

        for (let i = 1; i < conv.messages.length; i++) {
            const prevTimestamp = new Date(conv.messages[i - 1].timestamp)
                .getTime();
            const currentTimestamp = new Date(conv.messages[i].timestamp)
                .getTime();
            const timeDiff = currentTimestamp - prevTimestamp;

            if (timeDiff > timeThreshold) {
                // Push the current conversation and start a new one
                refined.push(currentConv);
                currentConv = {
                    ...conv,
                    id: conv.id, // Optionally assign a new ID or increment
                    messages: [conv.messages[i]],
                    participants: new Set([conv.messages[i].displayName]),
                    lastActive: new Date(conv.messages[i].timestamp),
                    conversationEmbedding: conv.messages[i].embedding.slice(),
                    embeddingSum: conv.messages[i].embedding.slice(),
                };
            } else {
                // Assign message to the current conversation
                currentConv.messages.push(conv.messages[i]);
                currentConv.participants.add(conv.messages[i].displayName);
                currentConv.lastActive = new Date(conv.messages[i].timestamp);
                currentConv.embeddingSum = addEmbeddings(
                    currentConv.embeddingSum,
                    conv.messages[i].embedding,
                );
                currentConv.conversationEmbedding = divideEmbedding(
                    currentConv.embeddingSum,
                    currentConv.messages.length,
                );
            }
        }

        // Push the last conversation
        refined.push(currentConv);
    });

    log(
        `Refined into ${refined.length} conversations after temporal segmentation.`,
        LogLevel.INFO,
    );

    return refined;
}

// Main Orchestration Function
export async function processConversations(guild: Guild): Promise<void> {
    try {
        // Step 1: Fetch and prepare messages
        const messages = await getFiresideMessages(guild);
        log(`Fetched ${messages.length} messages.`, LogLevel.INFO);

        // Step 2: Generate embeddings with caching and batch processing
        log("Generating embeddings...", LogLevel.INFO);
        await Promise.all(
            messages.map(async (message) => {
                message.embedding = await getEmbeddingWithCache(
                    message.message,
                );
                // Log embedding info for debugging (optional)
                if (message.embedding.some((val) => val !== 0)) {
                    log(
                        `Generated embedding for "${
                            message.message.substring(0, 30)
                        }...": [${
                            message.embedding.slice(0, 5).join(", ")
                        }...]`,
                        LogLevel.DEBUG,
                    );
                }
            }),
        );
        log("Embeddings generated.", LogLevel.INFO);

        // Step 3: Cluster conversations
        const clusteredConversations = await clusterConversations(messages);
        log(
            `Clustered into ${clusteredConversations.length} conversations.`,
            LogLevel.INFO,
        );

        // Step 4: Refine clusters based on time gaps
        const refinedConversations = refineClustersByTime(
            clusteredConversations,
            10, // 10-minute threshold
        );
        log(
            `Refined into ${refinedConversations.length} conversations after temporal segmentation.`,
            LogLevel.INFO,
        );

        // Further processing can be done here (e.g., storing in a database)
    } catch (error) {
        log(`Error processing conversations: ${error}`, LogLevel.ERROR);
    }
}
