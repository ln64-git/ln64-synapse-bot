import {
  Collection,
  Guild,
  Message,
  Snowflake,
  TextChannel,
} from "npm:discord.js"

type Conversation = {
  id: number
  messages: FiresideMessage[]
  participants: Set<string>
  lastActive: Date
  conversationEmbedding: number[]
  embeddingSum: number[]
}

type FiresideMessage = {
  displayName: string
  message: string
  timestamp: string
  embedding: number[]
}

export async function getFiresideMessages(
  guild: Guild
): Promise<FiresideMessage[]> {
  const channelId = Deno.env.get("CHANNEL_ID")
  if (!channelId) {
    throw new Error("CHANNEL_ID is not set in environment variables.")
  }

  const channel = guild.channels.resolve(channelId) as TextChannel
  if (!channel) {
    throw new Error(`Channel with ID ${channelId} not found.`)
  }

  // Fetch messages and ensure correct type
  const fetchedMessages: Collection<
    Snowflake,
    Message<true>
  > = await channel.messages.fetch({limit: 25})

  // Convert Collection to an array of Message<true>
  const messagesArray: Message<true>[] = Array.from(fetchedMessages.values())

  // Map over the array
  const firesideMessages: FiresideMessage[] = messagesArray.map((message) => ({
    displayName: message.member?.displayName || message.author.username,
    message: message.content,
    timestamp: message.createdAt.toISOString(),
    embedding: [],
  }))

  // Sort messages and save to JSON
  const sortedMessages = firesideMessages.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )
  const encoder = new TextEncoder()
  const json = JSON.stringify(sortedMessages, null, 2)
  await Deno.writeFile("./logs/messages.json", encoder.encode(json))
  return sortedMessages
}

export async function deriveConversations(
  messages: FiresideMessage[]
): Promise<Conversation[]> {
  // Messages are already sorted in getFiresideMessages
  const sortedMessages = messages

  // Generate embeddings
  for (const message of sortedMessages) {
    message.embedding = await getEmbedding(message.message)
  }

  const conversations: Conversation[] = []
  let conversationIdCounter = 0
  const timeThreshold = 5 * 60 * 1000 // 5 minutes
  const similarityThreshold = 0.7 // Adjust as needed

  for (const message of sortedMessages) {
    let assigned = false

    for (const conv of conversations) {
      const timeDiff =
        new Date(message.timestamp).getTime() - conv.lastActive.getTime()

      if (timeDiff < timeThreshold) {
        // Compare message embedding with conversation embedding
        const similarity = cosineSimilarity(
          message.embedding,
          conv.conversationEmbedding
        )

        if (similarity > similarityThreshold) {
          // Assign message to this conversation
          conv.messages.push(message)
          conv.participants.add(message.displayName)
          conv.lastActive = new Date(message.timestamp)

          // Update embedding sum
          conv.embeddingSum = addEmbeddings(
            conv.embeddingSum,
            message.embedding
          )

          // Recompute conversation embedding (average)
          conv.conversationEmbedding = divideEmbedding(
            conv.embeddingSum,
            conv.messages.length
          )

          assigned = true
          break
        }
      }
    }

    if (!assigned) {
      // Create new conversation
      const newConversation: Conversation = {
        id: conversationIdCounter++,
        messages: [message],
        participants: new Set([message.displayName]),
        lastActive: new Date(message.timestamp),
        conversationEmbedding: message.embedding.slice(), // Copy of the embedding
        embeddingSum: message.embedding.slice(), // Start sum with this embedding
      }
      conversations.push(newConversation)
    }
  }

  // Remove embeddings before saving or returning
  const conversationsWithoutEmbeddings = conversations.map((conv) => ({
    ...conv,
    messages: conv.messages.map(({embedding, ...rest}) => rest),
    conversationEmbedding: undefined,
    embeddingSum: undefined,
  }))

  // Save the conversations to a JSON file
  const encoder = new TextEncoder()
  const json = JSON.stringify(conversationsWithoutEmbeddings, null, 2)
  await Deno.writeFile("./logs/conversations.json", encoder.encode(json))

  return conversations
}

function addEmbeddings(embeddingA: number[], embeddingB: number[]): number[] {
  return embeddingA.map((val, idx) => val + embeddingB[idx])
}

function divideEmbedding(embedding: number[], divisor: number): number[] {
  return embedding.map((val) => val / divisor)
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) {
    console.warn(
      "Vectors have different lengths or are empty. Returning 0 similarity."
    )
    return 0
  }

  const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0)
  const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0))
  const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0))
  if (magnitudeA === 0 || magnitudeB === 0) {
    console.warn(
      "One of the vectors has zero magnitude. Returning 0 similarity."
    )
    return 0
  }
  return dotProduct / (magnitudeA * magnitudeB)
}

async function getEmbedding(text: string): Promise<number[]> {
  // Handle empty text
  if (!text.trim()) {
    console.warn("Empty message content; returning zero vector.")
    return Array(1536).fill(0) // Assuming the embedding size is 1536
  }

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      },
      body: JSON.stringify({
        input: text,
        model: "text-embedding-ada-002",
      }),
    })

    if (!response.ok) {
      console.error("Embedding API error:", response.statusText)
      return Array(1536).fill(0)
    }

    const data = await response.json()

    if (data && data.data && data.data[0] && data.data[0].embedding) {
      return data.data[0].embedding
    } else {
      console.error("Invalid embedding response format:", data)
      return Array(1536).fill(0)
    }
  } catch (error) {
    console.error("Error fetching embedding:", error)
    return Array(1536).fill(0)
  }
}
