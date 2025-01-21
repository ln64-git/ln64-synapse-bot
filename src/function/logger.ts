import { type Client, Message } from "discord.js";
import type { TrimmedMessage } from "../types/types";
import { convertToTrimmedMessage } from "../utils/utils";

export default async function logger(client: Client) {
    console.log(`Client is ready. Logged in as: ${client.user?.tag}`);

    client.on("messageDelete", async (message) => {
        console.log("message: ", message.content);
        let fullMessage: Message<true> | null = null;

        try {
            if (message.partial) {
                fullMessage = (await message.fetch()) as Message<true>;
                console.log("Fetched fullMessage: ", fullMessage);
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
                console.log(
                    "fullMessage.author.username: ",
                    fullMessage.author.username,
                );
                console.log("Ignoring message from Euphony:", fullMessage.id);
                return;
            }

            const trimmedData = convertToTrimmedMessage(fullMessage);
            console.log("trimmedData: ", trimmedData);
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

            let existingData = [];
            if (logExists) {
                try {
                    const fileContent = await fs.readFile(
                        currentLogFile,
                        "utf8",
                    );
                    existingData = JSON.parse(fileContent.trim() || "[]");
                } catch (error) {
                    console.error(
                        "Invalid JSON in log file. Resetting to empty array.",
                        error,
                    );
                    existingData = [];
                }
            }

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

        let existingData = [];
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
