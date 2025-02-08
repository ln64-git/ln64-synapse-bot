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
        const newUsername = member.user.username.toLowerCase();
        const newDisplayName = member.displayName.toLowerCase();
        const newAvatarUrl = member.user.displayAvatarURL({
            extension: "png",
            size: 1024,
        });

        // Check if username or display name has changed
        if (
            !this.aliases.has(newUsername) || !this.aliases.has(newDisplayName)
        ) {
            return true;
        }

        // Check if the stored avatar URL has changed before downloading the image
        const existingData = await this.collection.findOne({ id: this.id });
        if (existingData?.lastAvatarUrl === newAvatarUrl) {
            return false; // Avatar has not changed, no need to download
        }

        // Now download the image and check its hash
        const response = await axios.get(newAvatarUrl, {
            responseType: "arraybuffer",
        });
        const imageBuffer = Buffer.from(response.data);
        const imageHash = crypto.createHash("sha256").update(imageBuffer)
            .digest("hex");

        return !(await this.hasStoredAvatar(imageHash));
    }

    async updateUserData(): Promise<void> {
        await this.save();
    }

    async hasStoredAvatar(imageHash: string): Promise<boolean> {
        const existingImage = await this.photoBucket.find({
            "metadata.imageHash": imageHash,
        }).toArray();
        return existingImage.length > 0;
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
