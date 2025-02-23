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
        const logExists = await fs.access(currentLogFile).then(() => true)
            .catch(() => false);

        if (logExists) {
            // Read the existing file content
            const fileContent = await fs.readFile(currentLogFile, "utf8");
            existingData = JSON.parse(fileContent.trim() || "[]");
        }

        // ✅ **Remove Duplicates Before Appending**
        const uniqueEntries = new Map<string, any>();

        // Store existing logs in a Set for faster lookup
        existingData.forEach((entry) => {
            const key = JSON.stringify(entry); // Convert log to string for comparison
            uniqueEntries.set(key, entry);
        });

        // Add new entries only if they are unique
        data.forEach((newEntry) => {
            const key = JSON.stringify(newEntry);
            if (!uniqueEntries.has(key)) {
                uniqueEntries.set(key, newEntry);
            }
        });

        // Convert back to an array
        existingData = Array.from(uniqueEntries.values());

        // ✅ **Ensure Safe Sorting (Timestamps First)**
        existingData.sort((a: any, b: any) => {
            const timeA = a.activity?.startTime
                ? new Date(a.activity.startTime).getTime()
                : a.timestamp
                ? new Date(a.timestamp).getTime()
                : 0; // Default to 0 if no valid timestamp

            const timeB = b.activity?.startTime
                ? new Date(b.activity.startTime).getTime()
                : b.timestamp
                ? new Date(b.timestamp).getTime()
                : 0; // Default to 0 if no valid timestamp

            return timeB - timeA; // Sort latest logs first
        });

        // ✅ **Prevent Writing If No Changes Occurred**
        if (logExists) {
            const previousFileContent = await fs.readFile(
                currentLogFile,
                "utf8",
            );
            const previousData = JSON.parse(previousFileContent.trim() || "[]");

            if (JSON.stringify(previousData) === JSON.stringify(existingData)) {
                console.log(
                    `No new changes detected. Skipping log update for ${baseFileName}`,
                );
                return;
            }
        }

        // Save the updated log file
        await fs.writeFile(
            currentLogFile,
            JSON.stringify(existingData, null, 2),
            "utf8",
        );
        console.log(`✅ Saved updated log file: ${currentLogFile}`);
    } catch (err) {
        console.error("❌ Failed to save log:", err);
    }
}
