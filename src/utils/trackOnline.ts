import type { Client, Presence, User } from "discord.js";
import { saveLog } from "./logger";

const lastStatusMap = new Map<string, { status: string; timestamp: number }>();
const debounceTime = 3000; // 3 seconds debounce

export function trackOnline(userIds: string[], client: Client) {
    if (!userIds || userIds.length === 0) {
        throw new Error("At least one user ID must be provided.");
    }

    console.log(`Tracking online status for: ${userIds.join(", ")}`);

    const trackedUsers = new Set(userIds);
    const individualLogFile = "userStatusLogs"; // ✅ Only for user2
    const combinedLogFile = "userStatusLogsCombined"; // ✅ Contains both

    client.on(
        "presenceUpdate",
        (oldPresence: Presence | null, newPresence: Presence) => {
            if (!newPresence || !trackedUsers.has(newPresence.userId)) return;

            let user: User | undefined = client.users.cache.get(
                newPresence.userId,
            );
            if (!user) {
                console.warn(`User ${newPresence.userId} not found in cache.`);
                return;
            }

            const newStatus = newPresence.status;
            const now = Date.now();
            const lastEntry = lastStatusMap.get(user.id);

            // ✅ Skip duplicate logs
            if (lastEntry && lastEntry.status === newStatus) {
                return;
            }

            // ✅ Prevent instant duplicate logs with debounce
            if (lastEntry && now - lastEntry.timestamp < debounceTime) {
                return;
            }

            lastStatusMap.set(user.id, { status: newStatus, timestamp: now });

            const logEntry = {
                username: user.username,
                status: newStatus,
                timestamp: new Date().toISOString(),
            };

            // ✅ Only log user2 in `userStatusLogs`
            if (user.id === process.env.USER_2) {
                saveLog([logEntry], individualLogFile);
            }

            // ✅ Always log both users in `userStatusLogsCombined`
            saveLog([logEntry], combinedLogFile);

            console.log(
                `[${logEntry.timestamp}] ${user.username} is now ${newStatus.toUpperCase()}`,
            );
        },
    );
}
