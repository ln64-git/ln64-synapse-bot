import {
  Collection,
  Guild,
  Message,
  Snowflake,
  TextChannel,
} from "npm:discord.js"

// Define the structure of a FiresideMessage
type FiresideMessage = {
  displayName: string
  message: string
  timestamp: string
}

// Define the structure of a Conversation
type Conversation = {
  id: number
  messages: FiresideMessage[]
  participants: Set<string>
  lastActive: Date
}

async function getFiresideMessages(guild: Guild): Promise<FiresideMessage[]> {
  const channelId = Deno.env.get("CHANNEL_ID")
  if (!channelId) {
    throw new Error("CHANNEL_ID is not set in environment variables.")
  }

  const channel = guild.channels.resolve(channelId) as TextChannel
  if (!channel) {
    throw new Error(`Channel with ID ${channelId} not found.`)
  }

  // Fetch messages; adjust the limit as needed for context
  const fetchedMessages: Collection<
    Snowflake,
    Message<true>
  > = await channel.messages.fetch({limit: 100}) // Increase limit as needed

  // Convert Collection to an array and map to FiresideMessage
  const messagesArray: Message<true>[] = Array.from(fetchedMessages.values())

  const firesideMessages: FiresideMessage[] = messagesArray
    .map((message) => ({
      displayName: message.member?.displayName || message.author.username,
      message: message.content,
      timestamp: message.createdAt.toISOString(),
    }))
    .filter((msg) => msg.message.trim().length >= 1) // Adjust if needed

  // Sort messages chronologically
  const sortedMessages = firesideMessages.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )

  // Save sorted messages to a JSON file for debugging
  const encoder = new TextEncoder()
  const json = JSON.stringify(sortedMessages, null, 2)
  await Deno.writeFile("./logs/messages.json", encoder.encode(json))

  return sortedMessages
}

// Main Orchestration Function
export async function processConversations(guild: Guild): Promise<void> {
  try {
    // Step 1: Fetch and prepare messages
    const messages = await getFiresideMessages(guild)
    console.log(`Fetched ${messages.length} messages.`)

    // Step 2: Segment conversations based on time gaps
    const timeGapMinutes = 10 // Adjust as needed
    const conversations = segmentConversationsByTime(messages, timeGapMinutes)
    console.log(
      `Segmented into ${conversations.length} conversations based on time gaps.`
    )

    // Save conversations to JSON for debugging
    const conversationsToSave = conversations.map((conv) => ({
      id: conv.id,
      messages: conv.messages,
      participants: Array.from(conv.participants),
      lastActive: conv.lastActive.toISOString(),
    }))

    try {
      const encoder = new TextEncoder()
      const json = JSON.stringify(conversationsToSave, null, 2)
      await Deno.writeFile(
        "./logs/conversations_segmented.json",
        encoder.encode(json)
      )
      console.log(
        "Segmented conversations saved to ./log/conversations_segmented.json"
      )
    } catch (error) {
      console.log(`Error writing segmented conversations to file: ${error}`)
    }

    // Further processing can be done here (e.g., storing in a database)
  } catch (error) {
    console.log(`Error processing conversations: ${error}`)
  }
}

function segmentConversationsByTime(
  messages: FiresideMessage[],
  timeGapMinutes: number = 10
): Conversation[] {
  const conversations: Conversation[] = []
  const timeThreshold = timeGapMinutes * 60 * 1000 // Convert minutes to milliseconds

  let currentConvId = 0
  let currentConv: Conversation = {
    id: currentConvId,
    messages: [],
    participants: new Set(),
    lastActive: new Date(messages[0].timestamp),
  }

  currentConv.messages.push(messages[0])
  currentConv.participants.add(messages[0].displayName)

  for (let i = 1; i < messages.length; i++) {
    const prevTimestamp = new Date(messages[i - 1].timestamp).getTime()
    const currentTimestamp = new Date(messages[i].timestamp).getTime()
    const timeDiff = currentTimestamp - prevTimestamp

    if (timeDiff > timeThreshold) {
      // Start a new conversation
      conversations.push(currentConv)
      currentConvId++
      currentConv = {
        id: currentConvId,
        messages: [],
        participants: new Set(),
        lastActive: new Date(messages[i].timestamp),
      }
    }

    currentConv.messages.push(messages[i])
    currentConv.participants.add(messages[i].displayName)
    currentConv.lastActive = new Date(messages[i].timestamp)
  }

  // Push the last conversation
  conversations.push(currentConv)

  return conversations
}
