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
