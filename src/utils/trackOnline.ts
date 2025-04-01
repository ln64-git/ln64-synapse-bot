import { type Client } from "discord.js";
import { syncLog } from "./logger";

const STATUS_BUFFER_TIME = 5000;
const lastStatusLog = new Map<string, number>();
const lastKnownStatus = new Map<string, string>();

export function trackOnline(userIds: string[], client: Client) {
  client.on("presenceUpdate", async (oldPresence, newPresence) => {
    const userId = newPresence?.userId || oldPresence?.userId;
    if (!userId || !userIds.includes(userId)) return;

    const newStatus = newPresence?.status ?? "offline";
    const oldStatus = oldPresence?.status ?? lastKnownStatus.get(userId) ?? "offline";

    // Only log if status actually changed
    if (newStatus === oldStatus) return;

    const now = Date.now();
    const lastLogTime = lastStatusLog.get(userId) || 0;
    if (now - lastLogTime < STATUS_BUFFER_TIME) return;

    lastStatusLog.set(userId, now);
    lastKnownStatus.set(userId, newStatus);

    const username = newPresence?.user?.username || oldPresence?.user?.username || "Unknown User";

    const logEntry = {
      username,
      activities: [
        {
          status: newStatus,
          timestamp: new Date(now).toISOString(),
          humanTime: new Date(now).toLocaleString(),
        },
      ],
    };

    console.log("Syncing Log...", logEntry);
    await syncLog([logEntry], "userStatusLog");
  });
}
