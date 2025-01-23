import { Collection, Db } from "mongodb";
import type { GuildMember } from "discord.js";
import type { VoiceActivity } from "../../types/types";

export class UserProfile {
    private collection: Collection;
    // discord GuildMember
    public id: string;
    public aliases: Set<string> = new Set();
    // profile pictures array
    public keywords: Set<string> = new Set();
    public messageCount: number = 0;
    public lastActive: number = 0;
    public voiceActivity: Record<string, VoiceActivity> = {};

    constructor(public guildMember: GuildMember, private db: Db) {
        this.id = guildMember.id;
        this.collection = db.collection("userProfiles");
        this.addAlias(guildMember.user.username);
        this.addAlias(guildMember.displayName);
    }

    async incrementMessageCount(): Promise<void> {
        this.messageCount++;
        this.lastActive = Date.now();
        await this.save();
    }

    async trackVoiceActivity(
        channelId: string,
        isJoining: boolean,
    ): Promise<void> {
        const now = Date.now();

        if (isJoining) {
            this.voiceActivity[channelId] = { start: now, duration: 0 };
        } else if (this.voiceActivity[channelId]) {
            this.voiceActivity[channelId].duration += now -
                this.voiceActivity[channelId].start;
            delete this.voiceActivity[channelId];
        }

        await this.save();
    }

    addAlias(alias: string): void {
        this.aliases.add(alias.toLowerCase());
    }

    async save(): Promise<void> {
        await this.collection.updateOne(
            { id: this.id },
            { $set: this.toJSON() },
            { upsert: true },
        );
    }

    toJSON() {
        return {
            id: this.id,
            aliases: Array.from(this.aliases),
            messageCount: this.messageCount,
            lastActive: this.lastActive,
            voiceActivity: this.voiceActivity,
        };
    }

    static async load(db: Db, id: string): Promise<UserProfile | null> {
        const data = await db.collection("userProfiles").findOne({ id });
        if (!data) return null;

        const profile = new UserProfile({ id } as GuildMember, db); // Mock guildMember if needed
        Object.assign(profile, data); // Apply saved data to the profile instance
        return profile;
    }
}
