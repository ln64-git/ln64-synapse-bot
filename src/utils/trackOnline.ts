import { type Client } from "discord.js";
import { syncLog } from "./logger";

const STATUS_BUFFER_TIME = 1000; // 5 seconds buffer window
const lastStatusLog = new Map<string, number>();

export function trackOnline(userIds: string[], client: Client) {
  client.on("presenceUpdate", async (oldPresence, newPresence) => {
    if (!newPresence || !newPresence.userId || !userIds.includes(newPresence.userId)) return;

    const userId = newPresence.userId;
    const username = newPresence.user?.username || "Unknown User";
    const status = newPresence.status;
    const now = new Date();

    // Apply buffer window to prevent rapid duplicate logs
    const lastLogTime = lastStatusLog.get(userId) || 0;
    if (now.getTime() - lastLogTime < STATUS_BUFFER_TIME) {
      return;
    }
    lastStatusLog.set(userId, now.getTime());

    const logEntry = {
      username,
      userId,
      activities: [{ status, startTime: now.toISOString() }],
    };

    await syncLog([logEntry], "userStatusLog");
  });
}

