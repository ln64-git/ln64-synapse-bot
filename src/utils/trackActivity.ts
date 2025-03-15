import type { Activity, Client } from "discord.js";
import { syncLog } from "./logger";

type SpotifyActivity = {
    type: "Spotify";
    trackName: string;
    artistName: string;
    albumArt: string;
    startTime: string;
    endTime: string;
    duration: string;
};

type UserActivity = SpotifyActivity;

export function trackActivity(userIds: string[], client: Client) {
    if (!userIds || userIds.length === 0) {
        throw new Error("At least one user ID must be provided.");
    }

    const trackedUsers = new Set(userIds);
    const logFileName = "spotifyActivityLog";

    client.on("presenceUpdate", (oldPresence, newPresence) => {
        if (!newPresence || !trackedUsers.has(newPresence.userId)) return;

        const user = client.users.cache.get(newPresence.userId);
        if (!user) return;

        // ✅ **Extract only Spotify activity**
        const activities: UserActivity[] = newPresence.activities
            .filter((activity) => activity.name === "Spotify")
            .map(extractSpotifyActivity);

        // ✅ **Ignore logs if there is no Spotify activity**
        if (activities.length === 0) return;

        // ✅ **Sync log properly**
        console.log("Syncing Log...");
        syncLog([{ username: user.username, activities }], logFileName);
    });
}



function extractSpotifyActivity(activity: Activity): SpotifyActivity {
    const startTime = activity.timestamps?.start?.getTime();
    const endTime = activity.timestamps?.end?.getTime();
    const duration = startTime && endTime
        ? `${Math.floor((endTime - startTime) / 60000)}m ${Math.floor(((endTime - startTime) % 60000) / 1000)
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
