import { ChannelType, type Client, type Typing } from "discord.js";

export default async function logger(client: Client) {
    const confessionsChannelId = "1268661902834274448";

    // Log when the client is ready
    console.log(`Client is ready. Logged in as: ${client.user?.tag}`);

    const typingUsers = new Map<string, Date>();

    client.on("typingStart", async (typing: Typing) => {
        if (typing.channel.id === confessionsChannelId) {
            typingUsers.set(typing.user.id, new Date());
        }
    });
    client.on("messageCreate", async (message) => {
        if (message.channel.id === confessionsChannelId && message.author.bot) {
            // Match the most recent typing user
            const now = new Date();
            const matchedUser = Array.from(typingUsers.entries()).find(
                ([_, lastTyped]) => now.getTime() - lastTyped.getTime() < 5000, // 5-second window
            );

            if (matchedUser) {
                const [userId] = matchedUser;
                const user = await client.users.fetch(userId);
                const logMessage =
                    `${user.tag} likely sent a confession: "${message.content}"`;
                console.log(logMessage);
                await saveLog(logMessage, "confessionMessages");
            }
        }
    });
    client.on("messageUpdate", async (oldMessage, newMessage) => {
        if (newMessage.channel.id === confessionsChannelId) {
            const logMessage =
                `${newMessage.author?.tag} updated their message: "${oldMessage.content}" → "${newMessage.content}"`;
            console.log(logMessage);
            await saveLog(logMessage, "updatedMessages");
        }
    });

    client.on("messageCreate", async (message) => {
        if (message.content.startsWith("/confess")) {
            const logMessage =
                `${message.author.tag} sent a confession: "${message.content}"`;
            console.log(logMessage);
            await saveLog(logMessage, "confessionCommands");
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
