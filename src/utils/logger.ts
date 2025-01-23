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

        // Merge new data with existing data and deduplicate by `id`
        const mergedData = [
            ...data,
            ...existingData.filter(
                (msg: any) => !data.some((newMsg) => newMsg.id === msg.id),
            ),
        ];

        // Sort messages by timestamp in descending order
        mergedData.sort((a: any, b: any) => b.timestamp - a.timestamp);

        // Save the updated log file (no backups for `deletedMessages`)
        await fs.writeFile(
            currentLogFile,
            JSON.stringify(mergedData, null, 2),
            "utf8",
        );
        console.log(`Saved updated log file: ${currentLogFile}`);
    } catch (err) {
        console.error("Failed to save log:", err);
    }
}
