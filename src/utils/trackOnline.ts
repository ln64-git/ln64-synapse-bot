import type { Client, Presence, User } from "discord.js";
import { saveLog } from "./logger";

const lastStatusMap = new Map<string, string>(); // Track last known status

export function trackOnline(userIds: string[], client: Client) {
    if (!userIds || userIds.length === 0) {
        throw new Error("At least one user ID must be provided.");
    }

    console.log(`Tracking online status for: ${userIds.join(", ")}`);

    const trackedUsers = new Set(userIds);
    const logFileName = userIds.length > 1
        ? "userStatusLogsCombined"
        : "userStatusLogs";

    client.on(
        "presenceUpdate",
        (oldPresence: Presence | null, newPresence: Presence) => {
            if (!newPresence || !trackedUsers.has(newPresence.userId)) return;

            let user: User | undefined = client.users.cache.get(
                newPresence.userId,
            );
            if (!user) {
                console.warn(
                    `User ${newPresence.userId} not found in cache, presence update may be limited.`,
                );
                return;
            }

            const newStatus = newPresence.status; // "online", "offline", "idle", "dnd", "invisible"
            const lastStatus = lastStatusMap.get(user.id);

            if (lastStatus === newStatus) {
                return; // No status change, skip logging
            }

            lastStatusMap.set(user.id, newStatus); // Update last known status

            // Prepare log entry
            const logEntry = {
                username: user.username,
                status: newStatus,
                timestamp: new Date().toISOString(),
            };

            // Save log for individual users
            saveLog([logEntry], "userStatusLogs");

            // Save log for combined users
            saveLog([logEntry], "userStatusLogsCombined");

            console.log(
                `[${logEntry.timestamp}] ${user.username} is now ${newStatus.toUpperCase()}`,
            );
        },
    );
}
