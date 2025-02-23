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
    if (!userIds || userIds.length === 0) {
        throw new Error("At least one user ID must be provided.");
    }

    const trackedUsers = new Set(userIds);
    const logFileName = userIds.length > 1
        ? "activityLogCombined"
        : "activityLog";

    // Listen for presence updates (Ensure only one listener is attached)
    client.removeAllListeners("presenceUpdate");
    client.on("presenceUpdate", (oldPresence, newPresence) => {
        if (!newPresence || !trackedUsers.has(newPresence.userId)) return;

        const activeUser = client.users.cache.get(newPresence.userId);
        if (!activeUser) return;

        const newActivity = newPresence.activities.find(
            (a) => a.type === 2 || a.type === 4, // Prioritize Spotify
        );

        if (newActivity) {
            const userActivity: UserActivity = newActivity.name === "Spotify"
                ? extractSpotifyActivity(newActivity)
                : extractGeneralActivity(newActivity);

            const activityHash = JSON.stringify(userActivity);
            if (lastLoggedActivities.get(activeUser.id) === activityHash) {
                return; // Skip duplicate logs
            }

            lastLoggedActivities.set(activeUser.id, activityHash);
            saveLog(
                [{ username: activeUser.username, activity: userActivity }],
                logFileName, // Use correct log file name based on number of users
            );

            console.log(
                `Logged activity for ${activeUser.username} in ${logFileName}:`,
                userActivity,
            );
        }
    });

    console.log(`Tracking activity for: ${userIds.join(", ")}`);
}

function extractSpotifyActivity(activity: Activity): SpotifyActivity {
    return {
        type: "Spotify",
        trackName: activity.details || "Unknown Track",
        artistName: activity.state || "Unknown Artist",
        albumArt: activity.assets?.largeImageURL() || "No Album Art",
        startTime: activity.timestamps?.start?.toLocaleString() ||
            "Unknown Start Time",
        endTime: activity.timestamps?.end?.toLocaleString() ||
            "Unknown End Time",
        duration: activity.timestamps?.end && activity.timestamps?.start
            ? `${((activity.timestamps.end.getTime() -
                activity.timestamps.start.getTime()) / 1000)}s`
            : "Unknown Duration",
    };
}

function extractGeneralActivity(activity: Activity): GeneralActivity {
    return {
        type: "General",
        activityName: activity.name,
        timestamp: new Date().toISOString(), // Log timestamp in ISO format
    };
}
