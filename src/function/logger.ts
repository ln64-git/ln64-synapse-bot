import { type Client, Message } from "discord.js";
import type { TrimmedMessage } from "../types/types";
import { convertToTrimmedMessage } from "../utils/utils";

export default async function logger(client: Client) {
    // Log when the client is ready
    console.log(`Client is ready. Logged in as: ${client.user?.tag}`);

    client.on("messageDelete", async (message) => {
        let fullMessage: Message | null = null;
        try {
            fullMessage = message.partial ? await message.fetch() : message;
        } catch (err) {
            console.error("Failed to fetch the partial message:", err);
            return;
        }
        if (fullMessage) {
            await saveLog(fullMessage, "deletedMessages");
        }
    });
}

export async function saveLog(message: Message, fileName: string) {
    const fs = await import("fs/promises");
    const logFilePath =
        `/home/ln64/Source/ln64-synapse-bot/logs/${fileName}.log`;
    const trimmedMessage = convertToTrimmedMessage(message);
    try {
        await fs.appendFile(
            logFilePath,
            JSON.stringify(trimmedMessage, null, 2) + ",\n",
            "utf8",
        );
    } catch (err) {
        console.error("Failed to save log:", err);
    }
}
