import { ActivityType, type Activity, type Client } from "discord.js";
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
const lastLoggedActivityMap = new Map<string, string>(); // userId -> trackName-startTime

export function trackActivity(userIds: string[], client: Client) {
    if (!userIds || userIds.length === 0) {
        throw new Error("At least one user ID must be provided.");
    }

    const trackedUsers = new Set(userIds);
    const logFileName = "spotifyActivityLog";

    client.on("presenceUpdate", async (oldPresence, newPresence) => {
        if (!newPresence || !trackedUsers.has(newPresence.userId)) return;

        let user = client.users.cache.get(newPresence.userId);
        if (!user) {
            try {
                user = await client.users.fetch(newPresence.userId);
            } catch (err) {
                console.error(`Failed to fetch user ${newPresence.userId}`, err);
                return;
            }
        }
        const activities: UserActivity[] = Array.from(
            new Map(
                newPresence.activities
                    .filter(
                        (activity) =>
                            activity.name === "Spotify" &&
                            activity.type === ActivityType.Listening
                    )
                    .map(extractSpotifyActivity)
                    .map((a) => [`${a.trackName}-${a.startTime}`, a])
            ).values()
        );

        if (activities.length === 0) return;

        const latest = activities[0]; // assume deduped + sorted latest
        const cacheKey = `${latest.trackName}-${latest.startTime}`;
        const lastKey = lastLoggedActivityMap.get(newPresence.userId);

        if (lastKey === cacheKey) {
            console.log("⏩ Duplicate Spotify activity, skipping");
            return;
        }

        lastLoggedActivityMap.set(newPresence.userId, cacheKey);

        console.log("✅ New Spotify track detected. Logging...");
        syncLog([{ username: user.username, activities }], logFileName);
    });
}

function extractSpotifyActivity(activity: Activity): SpotifyActivity {
    const startTime = activity.timestamps?.start?.getTime();
    const endTime = activity.timestamps?.end?.getTime();
    const duration = startTime && endTime
        ? `${Math.floor((endTime - startTime) / 60000)}m ${Math.floor(((endTime - startTime) % 60000) / 1000)}s`
        : "Unknown Duration";

    return {
        type: "Spotify",
        trackName: activity.details || "Unknown Track",
        artistName: activity.state || "Unknown Artist",
        albumArt: activity.assets?.largeImageURL() || "No Album Art",
        startTime: activity.timestamps?.start?.toLocaleString() || "Unknown Start Time",
        endTime: activity.timestamps?.end?.toLocaleString() || "Unknown End Time",
        duration,
    };
}
