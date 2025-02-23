import type { Activity, Client } from "discord.js";
import { saveLog } from "./logger"; // Ensure saveLog is imported

type SpotifyActivity = {
    type: "Spotify";
    trackName: string;
    artistName: string;
    albumArt: string;
    startTime: string;
    endTime: string;
    duration: string;
};

type GeneralActivity = {
    type: "General";
    activityName: string;
    timestamp: string;
};

type UserActivity = SpotifyActivity | GeneralActivity;

// Track last logged activities for each user
const lastLoggedActivities = new Map<string, string>();

export function trackActivity(userIds: string[], client: Client) {
    try {
        if (!userIds || userIds.length === 0) {
            throw new Error("At least one user ID must be provided.");
        }

        const trackedUsers = new Set(userIds);
        const logFileName = userIds.length > 1
            ? "userActivityLogCombined"
            : "userActivityLog";

        // Listen for presence updates
        client.on("presenceUpdate", (oldPresence, newPresence) => {
            if (!newPresence || !trackedUsers.has(newPresence.userId)) return;

            const user = client.users.cache.get(newPresence.userId);
            if (!user) return;

            const newActivity = newPresence.activities.find((a) =>
                a.type === 2 || a.type === 4
            ); // Prioritize Spotify

            if (newActivity) {
                const userActivity: UserActivity =
                    newActivity.name === "Spotify"
                        ? extractSpotifyActivity(newActivity)
                        : extractGeneralActivity(newActivity);

                const activityHash = JSON.stringify(userActivity); // Unique identifier

                // Check if the same activity was already logged
                if (lastLoggedActivities.get(user.id) === activityHash) return;

                lastLoggedActivities.set(user.id, activityHash); // Update last logged activity

                // Save for both user1 & user2 (combined log)
                saveLog(
                    [{ username: user.username, activity: userActivity }],
                    logFileName,
                );

                console.log(
                    `Logged activity for ${user.username}:`,
                    userActivity,
                );
            }
        });
    } catch (error) {
        console.error("Error setting up activity tracking:", error);
    }
}

function extractSpotifyActivity(activity: Activity): SpotifyActivity {
    const startTime = activity.timestamps?.start?.getTime();
    const endTime = activity.timestamps?.end?.getTime();
    const duration = startTime && endTime
        ? `${Math.floor((endTime - startTime) / 60000)}m ${
            Math.floor(((endTime - startTime) % 60000) / 1000)
        }s`
        : "Unknown Duration";

    return {
        type: "Spotify",
        trackName: activity.details || "Unknown Track",
        artistName: activity.state || "Unknown Artist",
        albumArt: activity.assets?.largeImageURL() || "No Album Art",
        startTime: activity.timestamps?.start?.toLocaleString() ||
            "Unknown Start Time",
        endTime: activity.timestamps?.end?.toLocaleString() ||
            "Unknown End Time",
        duration,
    };
}

function extractGeneralActivity(activity: Activity): GeneralActivity {
    return {
        type: "General",
        activityName: activity.name,
        timestamp: new Date().toISOString(),
    };
}
