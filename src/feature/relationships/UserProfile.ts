import { Collection, Db, GridFSBucket } from "mongodb";
import type { GuildMember } from "discord.js";
import axios from "axios";
import crypto from "crypto";

export class UserProfile {
    private collection: Collection;
    private photoBucket: GridFSBucket;
    public id: string;
    public guildMember: GuildMember;
    public aliases: Set<string> = new Set();
    public messageCount: number = 0;
    public lastActive: number = 0;

    constructor(public discordGuildMember: GuildMember, private db: Db) {
        this.id = discordGuildMember.id;
        this.guildMember = discordGuildMember;
        this.collection = db.collection("userProfiles");
        this.photoBucket = new GridFSBucket(db, {
            bucketName: "profilePictures",
        });

        this.addAlias(discordGuildMember.user.username);
        this.addAlias(discordGuildMember.displayName);
    }

    async hasDifferentData(member: GuildMember): Promise<boolean> {
        return (
            this.guildMember.id !== member.id || // Different user
            this.guildMember.user.username !== member.user.username || // Username changed
            this.guildMember.displayName !== member.displayName || // Nickname changed
            this.guildMember.roles.cache.size !== member.roles.cache.size || // Role count changed
            ![...this.guildMember.roles.cache.keys()].every((role) =>
                member.roles.cache.has(role)
            ) // Roles changed
        );
    }

    async updateUserData(): Promise<void> {
        await this.save();
    }

    async incrementMessageCount(): Promise<void> {
        this.messageCount++;
        this.lastActive = Date.now();
        await this.save();
    }

    addAlias(alias: string): void {
        if (!this.aliases.has(alias.toLowerCase())) {
            this.aliases.add(alias.toLowerCase());
        }
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
        };
    }

    static async load(db: Db, id: string): Promise<UserProfile | null> {
        const data = await db.collection("userProfiles").findOne({ id });
        if (!data) return null;

        const profile = new UserProfile({ id } as GuildMember, db);
        Object.assign(profile, data);
        return profile;
    }
}
