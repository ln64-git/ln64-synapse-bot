import { type Client, Message } from "discord.js";
import type { TrimmedMessage } from "../types/types";
import { convertToTrimmedMessage } from "../utils/utils";

export default async function logger(client: Client) {
    console.log(`Client is ready. Logged in as: ${client.user?.tag}`);

    client.on("messageDelete", async (message) => {
        let fullMessage: Message<true> | null = null;

        try {
            if (message.partial) {
                // Cast the fetched message to Message<true>
                fullMessage = (await message.fetch()) as Message<true>;
            } else {
                // Directly cast the non-partial message to Message<true>
                fullMessage = message as Message<true>;
            }
        } catch (err) {
            console.error("Failed to fetch the partial message:", err);
            return;
        }

        if (fullMessage) {
            // Ignore messages from "Euphony"
            if (fullMessage.author.username === "Euphony" || "LunaBot 🌙") {
                console.log("Ignoring message from Euphony:", fullMessage.id);
                return;
            }

            const trimmedData = convertToTrimmedMessage(fullMessage);
            await saveLog([trimmedData], "deletedMessages");
        }
    });
}

export async function saveLog(data: object[], baseFileName: string) {
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
        // Ensure the logs directory exists
        await fs.mkdir(logsDir, { recursive: true });

        if (baseFileName === "deletedMessages") {
            // Append to the same file for "deletedMessages"
            const logExists = await fs
                .access(currentLogFile)
                .then(() => true)
                .catch(() => false);

            const existingData = logExists
                ? JSON.parse(await fs.readFile(currentLogFile, "utf8"))
                : [];

            // Combine old and new data, keeping the latest 100 messages
            const updatedData = [...existingData, ...data].slice(-100);

            await fs.writeFile(
                currentLogFile,
                JSON.stringify(updatedData, null, 2),
                "utf8",
            );

            console.log(`Appended to log file: ${currentLogFile}`);
            return;
        }

        // Ensure the old logs directory exists for other log types
        await fs.mkdir(oldLogsDir, { recursive: true });

        // Check if the main log file exists
        const logExists = await fs
            .access(currentLogFile)
            .then(() => true)
            .catch(() => false);

        if (logExists) {
            // Move the current log file to the date-named folder
            const oldFileName = `${baseFileName}-${formattedTimestamp}.json`;
            const oldFilePath = path.join(oldLogsDir, oldFileName);
            await fs.rename(currentLogFile, oldFilePath);
        }

        // Save only the latest 100 messages in the new log file
        const latestData = data.slice(-100);
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
