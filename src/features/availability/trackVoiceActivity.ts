import { Client } from "discord.js";
import { Db } from "mongodb";

export default function trackVoiceActivity(client: Client, db: Db) {
  client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
      const member = newState.member ?? oldState.member;
      const userId = member?.id;
      if (!userId) return;
      if (member.user?.bot) return; // ignore bot accounts

      const oldChannelId = oldState.channelId;
      const newChannelId = newState.channelId;

      // No change in channel
      if (oldChannelId === newChannelId) return;

      const now = new Date();
      const base = {
        userId,
        username: member.user?.username ?? null,
        guildId: newState.guild?.id ?? oldState.guild?.id ?? null,
        timestampIso: now.toISOString(),
        timestampMs: now.getTime(),
      } as const;

      // Move between channels: log a leave for old and a join for new
      if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
        const leaveEvent = {
          ...base,
          type: "leave" as const,
          channelId: oldChannelId,
          channelName: oldState.channel?.name ?? null,
        };
        const joinEvent = {
          ...base,
          type: "join" as const,
          channelId: newChannelId,
          channelName: newState.channel?.name ?? null,
        };
        await db.collection("voiceEvents").insertMany([leaveEvent, joinEvent]);
        return;
      }

      // Joined a channel
      if (!oldChannelId && newChannelId) {
        const joinEvent = {
          ...base,
          type: "join" as const,
          channelId: newChannelId,
          channelName: newState.channel?.name ?? null,
        };
        await db.collection("voiceEvents").insertOne(joinEvent);
        return;
      }

      // Left a channel
      if (oldChannelId && !newChannelId) {
        const leaveEvent = {
          ...base,
          type: "leave" as const,
          channelId: oldChannelId,
          channelName: oldState.channel?.name ?? null,
        };
        await db.collection("voiceEvents").insertOne(leaveEvent);
        return;
      }
    } catch (error) {
      console.error("Failed to record voice activity:", error);
    }
  });
}