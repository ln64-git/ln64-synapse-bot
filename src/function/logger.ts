import { ChannelType, type Client, type Typing } from "discord.js";

export default async function logger(client: Client) {
    const confessionsChannelId = "1268661902834274448";

    // Log when the client is ready
    console.log(`Client is ready. Logged in as: ${client.user?.tag}`);

    // Listen for typing in the specified channel
    client.on("typingStart", async (typing: Typing) => {
        if (typing.channel.id === confessionsChannelId) {
            const logMessage =
                `${typing.user.displayName} started typing in Confessions...`;
            console.log(logMessage);
            await saveLog(logMessage, "loggedMessages");
        }
    });
    // Listen for message deletions in the specified channel
    client.on("messageDelete", async (message) => {
        if (message.author?.displayName === "Euphony") {
            return;
        }
        const channelName = message.channel.type === ChannelType.GuildText
            ? message.channel.name
            : "unknown channel";
        const logMessage =
            `${message.author?.displayName} deleted a message: "${message.content}" in ${channelName}`;
        console.log(logMessage);
        await saveLog(logMessage, "deletedMessages");
    });
}

async function saveLog(message: string, fileName: string) {
    const fs = await import("fs");
    const logFilePath =
        `/home/ln64/Source/ln64-synapse-bot/logs/${fileName}.log`;

    fs.appendFile(
        logFilePath,
        `${new Date().toISOString()} - ${message}\n`,
        (err) => {
            if (err) {
                console.error("Failed to save log:", err);
            }
        },
    );
}
