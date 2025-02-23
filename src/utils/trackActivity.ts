import type { Activity, Client } from "discord.js";
import { saveLog } from "./logger";

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

type CustomStatusActivity = {
    type: "CustomStatus";
    statusText: string;
    timestamp: string;
};

// ✅ **Union Type for Activities**
type UserActivity = SpotifyActivity | GeneralActivity | CustomStatusActivity;

// Track last logged activities per user
const lastLoggedActivities = new Map<string, string>();
const lastLogTimestamps = new Map<string, number>(); // Debounce mechanism
const debounceTime = 3000; // 3 seconds

export function trackActivity(userIds: string[], client: Client) {
    if (!userIds || userIds.length === 0) {
        throw new Error("At least one user ID must be provided.");
    }

    const trackedUsers = new Set(userIds);
    const logFileName = userIds.length > 1
        ? "userActivityLogCombined"
        : "userActivityLog";

    client.on("presenceUpdate", (oldPresence, newPresence) => {
        if (!newPresence || !trackedUsers.has(newPresence.userId)) return;

        const user = client.users.cache.get(newPresence.userId);
        if (!user) return;

        // ✅ **Extract all activities, including Custom Status**
        const activities: UserActivity[] = newPresence.activities.map(
            (activity) => {
                if (activity.name === "Spotify") {
                    return extractSpotifyActivity(activity);
                } else if (activity.type === 4 && activity.state) {
                    return extractCustomStatus(activity);
                } else {
                    return extractGeneralActivity(activity);
                }
            },
        );

        // ✅ **Ignore logs if only Custom Status is present**
        const hasCustomStatusOnly = activities.length === 1 &&
            activities[0].type === "CustomStatus";
        if (hasCustomStatusOnly) return;

        // ✅ **Prevent duplicate logs & debounce**
        const now = Date.now();
        const activityHash = JSON.stringify(activities);
        const lastActivityHash = lastLoggedActivities.get(user.id);
        const lastTimestamp = lastLogTimestamps.get(user.id) || 0;

        if (
            lastActivityHash === activityHash &&
            now - lastTimestamp < debounceTime
        ) {
            return; // Skip logging if no changes or within debounce time
        }

        lastLoggedActivities.set(user.id, activityHash);
        lastLogTimestamps.set(user.id, now);

        console.log(
            `Logged updated activities for ${user.username}:`,
            activities,
        );

        // ✅ **Save log properly**
        console.log("Saving Log...");
        saveLog([{ username: user.username, activities }], logFileName);
    });
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
        activityName: activity.name || "Unknown Activity",
        timestamp: new Date().toISOString(),
    };
}

function extractCustomStatus(activity: Activity): CustomStatusActivity {
    return {
        type: "CustomStatus",
        statusText: activity.state || "No Status",
        timestamp: new Date().toISOString(),
    };
}
