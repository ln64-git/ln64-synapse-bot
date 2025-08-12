import type { Client } from "discord.js";
import type { Db } from "mongodb";

export default async function stayBanned(client: Client, db: Db) {

  client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!db) {
      console.error("❌ stayBanned: 'db' is undefined!");
      return;
    }

    const member = newState.member;
    if (!member || !newState.channel) return;
    const channelMembers = newState.channel.members;

    for (const [_, user] of channelMembers) {
      if (user.id === member.id) continue;
      // Check if this user blocked the joining user or vice versa
      const blocked = await db.collection('vcBlocks').findOne({
        $or: [
          { blocker: user.id, blocked: member.id },
          { blocker: member.id, blocked: user.id }
        ]
      });
      if (blocked) {
        // Option 1: Move the blocked person out
        await member.voice.disconnect(); // or .setChannel(null)
        // Option 2: Kick both and send a message
        await newState.guild.systemChannel?.send(`${member.user.tag} can't join VC with ${user.user.tag} because they are blocked.`);
        break;
      }
    }
  });

}