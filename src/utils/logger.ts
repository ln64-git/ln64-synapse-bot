import { type Client, Message } from "discord.js";
import { convertToTrimmedMessage } from "./utils";
import path from "path";
import { promises as fs } from "fs";

export default async function logger(client: Client) {
    client.on("messageDelete", async (message) => {
        let fullMessage: Message<true> | null = null;

        try {
            if (message.partial) {
                fullMessage = (await message.fetch()) as Message<true>;
            } else {
                fullMessage = message as Message<true>;
            }
        } catch (err) {
            console.error("Failed to fetch the partial message:", err);
            return;
        }

        if (fullMessage) {
            if (
                fullMessage.author.username === "Euphony" ||
                fullMessage.author.username === "LunaBot 🌙"
            ) {
                console.log("Ignoring message from Euphony:", fullMessage.id);
                return;
            }

            const trimmedData = convertToTrimmedMessage(fullMessage);
            await saveLog([trimmedData], "deletedMessages");
        }
    });
}

export async function saveLog(data: any[], baseFileName: string) {
    const logsDir = path.join(process.cwd(), "logs");
    const currentLogFile = path.join(logsDir, `${baseFileName}.json`);

    try {
        // Ensure logs directory exists
        await fs.mkdir(logsDir, { recursive: true });

        let existingData: any[] = [];
        const logExists = await fs
            .access(currentLogFile)
            .then(() => true)
            .catch(() => false);

        if (logExists) {
            // Read the existing file content
            const fileContent = await fs.readFile(currentLogFile, "utf8");
            existingData = JSON.parse(fileContent.trim() || "[]");
        }

        // Append new data to existing logs
        existingData.push(...data);

        // **Fix: Ensure safe sorting by checking for 'activity' field**
        existingData.sort((a: any, b: any) => {
            const timeA = a.activity?.startTime
                ? new Date(a.activity.startTime).getTime()
                : a.activity?.timestamp
                ? new Date(a.activity.timestamp).getTime()
                : 0; // Default to 0 if no valid timestamp

            const timeB = b.activity?.startTime
                ? new Date(b.activity.startTime).getTime()
                : b.activity?.timestamp
                ? new Date(b.activity.timestamp).getTime()
                : 0; // Default to 0 if no valid timestamp

            return timeB - timeA; // Sort in descending order (latest first)
        });

        // Save the updated log file
        await fs.writeFile(
            currentLogFile,
            JSON.stringify(existingData, null, 2),
            "utf8",
        );
        console.log(`Saved updated log file: ${currentLogFile}`);
    } catch (err) {
        console.error("Failed to save log:", err);
    }
}
