import { type Client, Message } from "discord.js";
import type { TrimmedMessage } from "../types/types";
import { convertToTrimmedMessage } from "../utils/utils";

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
    const fs = await import("fs/promises");
    const path = await import("path");

    const logsDir = path.join(process.cwd(), "logs");
    const timestamp = new Date();
    const formattedDate = timestamp.toISOString().split("T")[0].replace(
        /-/g,
        "-",
    );
    const oldLogsDir = path.join(logsDir, "old", formattedDate);
    const formattedTimestamp = timestamp.toISOString().replace(/[:.]/g, "-");
    const currentLogFile = path.join(logsDir, `${baseFileName}.json`);

    try {
        await fs.mkdir(logsDir, { recursive: true });

        let existingData: any[] = [];
        const logExists = await fs
            .access(currentLogFile)
            .then(() => true)
            .catch(() => false);

        if (logExists) {
            try {
                const fileContent = await fs.readFile(currentLogFile, "utf8");
                existingData = JSON.parse(fileContent.trim() || "[]");
            } catch (error) {
                console.error(
                    "Invalid JSON in log file. Resetting to empty array.",
                    error,
                );
                existingData = [];
            }
        }

        // Check for unique messages
        const existingMessageIds = new Set(
            existingData.map((msg: any) => msg.id),
        );
        const allMessagesNew = data.every((msg: any) =>
            !existingMessageIds.has(msg.id)
        );

        if (allMessagesNew && data.length === 100) {
            // Backup current log file if it exists
            if (logExists) {
                await fs.mkdir(oldLogsDir, { recursive: true });
                const oldFileName =
                    `${baseFileName}-${formattedTimestamp}.json`;
                const oldFilePath = path.join(oldLogsDir, oldFileName);
                await fs.rename(currentLogFile, oldFilePath);
                console.log(`Backed up log file: ${oldFilePath}`);
            }

            // Save new data as the current log file
            await fs.writeFile(
                currentLogFile,
                JSON.stringify(data, null, 2),
                "utf8",
            );
            console.log(`Saved latest log file: ${currentLogFile}`);
        } else {
            console.log(
                "No backup created. Not all messages are new or incomplete batch.",
            );
        }
    } catch (err) {
        console.error("Failed to save log:", err);
    }
}
