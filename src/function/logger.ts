import { type Client, Message } from "discord.js";
import type { TrimmedMessage } from "../types/types";
import { convertToTrimmedMessage } from "../utils/utils";

export default async function logger(client: Client) {
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
            const trimmedData = convertToTrimmedMessage(fullMessage);
            await saveLog([trimmedData], "deletedMessages");
        }
    });
}

export async function saveLog(data: object[], baseFileName: string) {
    const fs = await import("fs/promises");
    const path = await import("path");

    const logsDir = path.join(process.cwd(), "logs");
    const oldLogsDir = path.join(logsDir, "old");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const currentLogFile = path.join(logsDir, `${baseFileName}.json`); // Single main file

    try {
        // Ensure the logs and old folders exist
        await fs.mkdir(logsDir, { recursive: true });
        await fs.mkdir(oldLogsDir, { recursive: true });

        // Check if the main log file exists
        const logExists = await fs
            .access(currentLogFile)
            .then(() => true)
            .catch(() => false);

        if (logExists) {
            // Move the current log file to the old directory
            const oldFileName = `${baseFileName}-${timestamp}.json`;
            const oldFilePath = path.join(oldLogsDir, oldFileName);
            await fs.rename(currentLogFile, oldFilePath);
            console.log("log: ", oldLogsDir);
            console.log(`Moved existing log to: ${oldFilePath}`);
        }

        // Save only the latest 100 messages in the new log file
        const latestData = data.slice(-100); // Keep only the last 100 messages
        await fs.writeFile(
            currentLogFile,
            JSON.stringify(latestData, null, 2),
            "utf8",
        );

        console.log(`Saved latest log file: ${currentLogFile}`);
    } catch (err) {
        console.error("Failed to save log:", err);
    }
}
