// getFiresideMessages.ts

import {
  Collection,
  Guild,
  Message,
  Snowflake,
  TextChannel,
} from "npm:discord.js"

export async function getFiresideMessages(guild: Guild): Promise<Message[]> {
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
  > = await channel.messages.fetch({limit: 100})

  // Convert Collection to an array of Message<true>
  const messagesArray: Message<true>[] = Array.from(fetchedMessages.values())

  // Sort messages and save to JSON
  const sortedMessages = messagesArray.sort(
    (a, b) =>
      new Date(a.createdTimestamp).getTime() -
      new Date(b.createdTimestamp).getTime()
  )

  const encoder = new TextEncoder()
  const json = JSON.stringify(sortedMessages, null, 2)
  await Deno.writeFile("./logs/messages.json", encoder.encode(json))

  console.log("Fireside messages successfully fetched and saved.")
  return sortedMessages
}
