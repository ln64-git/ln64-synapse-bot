import {
    Collection,
    Guild,
    Message,
    Snowflake,
    TextChannel,
} from "npm:discord.js";

// Define your FiresideMessage type
type FiresideMessage = {
    displayName: string;
    message: string;
    timestamp: string;
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
    }));

    // Save the firesideMessages to a JSON file
    const encoder = new TextEncoder();
    const json = JSON.stringify(firesideMessages, null, 2);
    await Deno.writeFile("./log/messages.json", encoder.encode(json));
    return firesideMessages;
}
