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
        await fs.mkdir(logsDir, { recursive: true });

        let existingData: any[] = [];
        const logExists = await fs.access(currentLogFile).then(() => true)
            .catch(() => false);

        if (logExists) {
            const fileContent = await fs.readFile(currentLogFile, "utf8");
            existingData = JSON.parse(fileContent.trim() || "[]");
        }

        let processedData = data;

        if (baseFileName.includes("userActivityLog")) {
            processedData = processDuplicateActivities(existingData, data);
        }

        // ✅ **Ensure Activities Per User are Sorted (Most Recent First)**
        processedData.forEach((userEntry) => {
            if (userEntry.activities) {
                userEntry.activities.sort((
                    a: { startTime: string | number | Date },
                    b: { startTime: string | number | Date },
                ) => new Date(b.startTime).getTime() -
                    new Date(a.startTime).getTime()
                );
            }
        });

        // ✅ **Prevent Writing If No Changes Occurred**
        if (logExists) {
            const previousFileContent = await fs.readFile(
                currentLogFile,
                "utf8",
            );
            const previousData = JSON.parse(previousFileContent.trim() || "[]");

            if (
                JSON.stringify(previousData) === JSON.stringify(processedData)
            ) {
                console.log(
                    `No new changes detected. Skipping log update for ${baseFileName}`,
                );
                return;
            }
        }

        // ✅ **Write the processed data**
        await fs.writeFile(
            currentLogFile,
            JSON.stringify(processedData, null, 2),
            "utf8",
        );
        console.log(`✅ Saved updated log file: ${currentLogFile}`);
    } catch (err) {
        console.error("❌ Failed to save log:", err);
    }
}

function getLatestTimestamp(activities: any[]): number {
    if (!activities || activities.length === 0) return 0;

    return Math.max(
        ...activities.map((activity) => {
            if (activity.startTime) {
                return new Date(activity.startTime).getTime();
            }
            if (activity.timestamp) {
                return new Date(activity.timestamp).getTime();
            }
            return 0;
        }),
    );
}

function processDuplicateActivities(
    existingData: any[],
    newData: any[],
): any[] {
    console.log("existingData: ", existingData);
    const userActivityMap = new Map<string, any>();

    [...existingData, ...newData].forEach((entry) => {
        const key = entry.username;

        if (!userActivityMap.has(key)) {
            userActivityMap.set(key, {
                username: entry.username,
                activities: entry.activities || [],
            });
        } else {
            const existingEntry = userActivityMap.get(key);

            // ✅ **Merge activities before saving**
            existingEntry.activities = mergeActivities(
                existingEntry.activities,
                entry.activities,
            );

            userActivityMap.set(key, existingEntry);
        }
    });

    return Array.from(userActivityMap.values());
}

/**
 * ✅ **Handles Duplicate User Status Logs**
 */
function processDuplicateStatus(existingData: any[], newData: any[]): any[] {
    const userStatusMap = new Map<string, any>();

    [...existingData, ...newData].forEach((entry) => {
        const key = entry.username;
        if (!userStatusMap.has(key)) {
            userStatusMap.set(key, entry);
        } else {
            const existingEntry = userStatusMap.get(key);
            if (existingEntry.status !== entry.status) {
                userStatusMap.set(key, entry); // Update only if status changed
            }
        }
    });

    return Array.from(userStatusMap.values());
}

/**
 * ✅ **Handles Duplicate Deleted Messages**
 */
function processDuplicateMessages(existingData: any[], newData: any[]): any[] {
    const messageSet = new Set<string>();

    const combinedData = [...existingData, ...newData].filter((entry) => {
        const key = JSON.stringify(entry);
        if (!messageSet.has(key)) {
            messageSet.add(key);
            return true;
        }
        return false;
    });

    return combinedData;
}

function mergeActivities(
    existingActivities: any[],
    newActivities: any[],
): any[] {
    if (!Array.isArray(existingActivities)) existingActivities = [];
    if (!Array.isArray(newActivities)) newActivities = [];

    const activityMap = new Map<string, any>();

    [...existingActivities, ...newActivities].forEach((activity) => {
        if (activity.type === "Spotify") {
            const key = `${activity.trackName} - ${activity.artistName}`;

            if (activityMap.has(key)) {
                const existingActivity = activityMap.get(key);

                // ✅ **Preserve earliest `startTime`**
                existingActivity.startTime =
                    new Date(existingActivity.startTime).getTime() <
                            new Date(activity.startTime).getTime()
                        ? existingActivity.startTime
                        : activity.startTime;

                // ✅ **Update `endTime` to latest**
                existingActivity.endTime =
                    new Date(existingActivity.endTime).getTime() >
                            new Date(activity.endTime).getTime()
                        ? existingActivity.endTime
                        : activity.endTime;

                // ✅ **Recalculate `duration`**
                existingActivity.duration = calculateDuration(
                    existingActivity.startTime,
                    existingActivity.endTime,
                );
            } else {
                activityMap.set(key, activity);
            }
        } else {
            // ✅ **For non-Spotify activities, store them separately**
            const key = JSON.stringify(activity);
            if (!activityMap.has(key)) {
                activityMap.set(key, activity);
            }
        }
    });

    return Array.from(activityMap.values());
}

function getEarliestTimestamp(activities: any[]): number {
    if (!activities || activities.length === 0) return 0;

    return Math.min(
        ...activities.map((activity) => {
            if (activity.startTime) {
                return new Date(activity.startTime).getTime();
            }
            if (activity.timestamp) {
                return new Date(activity.timestamp).getTime();
            }
            return 0;
        }),
    );
}

function calculateDuration(startTime: string, endTime: string): string {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const durationMs = end - start;

    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);

    return `${minutes}m ${seconds}s`;
}
