import {
    Collection,
    Guild,
    Message,
    Snowflake,
    TextChannel,
} from "npm:discord.js";

type Conversation = {
    id: number;
    messages: FiresideMessage[];
    participants: Set<string>;
    lastActive: Date;
};

type FiresideMessage = {
    displayName: string;
    message: string;
    timestamp: string;
    embedding: number[];
};

export async function getFiresideMessages(
    guild: Guild,
): Promise<FiresideMessage[]> {
    const channelId = Deno.env.get("CHANNEL_ID"); // Or use process.env.CHANNEL_ID for Node.js
    if (!channelId) {
        throw new Error("CHANNEL_ID is not set in environment variables.");
    }

    const channel = guild.channels.resolve(channelId) as TextChannel;
    if (!channel) {
        throw new Error(`Channel with ID ${channelId} not found.`);
    }

    // Fetch messages and ensure correct type
    const fetchedMessages: Collection<Snowflake, Message<true>> = await channel
        .messages.fetch({ limit: 25 });

    // Convert Collection to an array of Message<true>
    const messagesArray: Message<true>[] = Array.from(fetchedMessages.values());

    // Map over the array
    const firesideMessages: FiresideMessage[] = messagesArray.map((
        message,
    ) => ({
        displayName: message.author.displayName,
        message: message.content,
        timestamp: message.createdAt.toISOString(),
        embedding: [],
    }));

    const sortedMessages = firesideMessages.sort(
        (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    const encoder = new TextEncoder();
    const json = JSON.stringify(sortedMessages, null, 2);
    await Deno.writeFile(
        "./log/messages.json",
        encoder.encode(json),
    );
    return firesideMessages;
}

export async function deriveConversations(
    messages: FiresideMessage[],
): Promise<Conversation[]> {
    // Sort messages
    const sortedMessages = messages.sort(
        (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    // Generate embeddings
    for (const message of sortedMessages) {
        message.embedding = await getEmbedding(message.message);
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
                const lastMessage = conv.messages[conv.messages.length - 1];
                const similarity = cosineSimilarity(
                    message.embedding,
                    lastMessage.embedding,
                );

                if (similarity > similarityThreshold) {
                    conv.messages.push(message);
                    conv.participants.add(message.displayName);
                    conv.lastActive = new Date(message.timestamp);
                    assigned = true;
                    break;
                }
            }
        }

        if (!assigned) {
            const newConversation: Conversation = {
                id: conversationIdCounter++,
                messages: [message],
                participants: new Set([message.displayName]),
                lastActive: new Date(message.timestamp),
            };
            conversations.push(newConversation);
        }
    }

    const conversationsWithoutEmbeddings = conversations.map((conv) => ({
        ...conv,
        messages: conv.messages.map(({ embedding, ...rest }) => rest),
    }));
    const encoder = new TextEncoder();
    const json = JSON.stringify(conversationsWithoutEmbeddings, null, 2);
    await Deno.writeFile(
        "./log/conversations.json",
        encoder.encode(json),
    );
    return conversations;
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
    const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
}

async function getEmbedding(text: string): Promise<number[]> {
    // Call an external API or service to get the embedding
    // For example, using OpenAI API
    const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        },
        body: JSON.stringify({
            input: text,
            model: "text-embedding-ada-002",
        }),
    });

    const data = await response.json();
    return data.data[0].embedding;
}
