import type { GuildMember } from "discord.js";
import type {
    RelationshipNetwork,
    UserConnection,
} from "./RelationshipNetwork";

export class UserProfile {
    // General Information
    public id: string;
    public guildMember: GuildMember;

    // Activity Metrics
    public messageCount: number = 0;
    public lastActiveTimestamp: number = 0;
    public voiceActivityDuration: number = 0;

    // Insights and Analysis
    public sentimentScore: number = 0; // -1 (negative) to +1 (positive)
    public toxicityScore: number = 0;
    public keywords: Set<string> = new Set();
    public aliases: string[] = [];
    public insights: Record<string, any> = {};

    // Relationships
    public relationshipStrengths: Map<string, UserConnection[]> = new Map();

    constructor(id: string, username: string, guildMember: GuildMember) {
        this.id = id;
        this.guildMember = guildMember;
        this.addAlias(username);
        this.addAlias(guildMember.displayName);
    }

    // ---------------------
    // Activity Methods
    // ---------------------

    updateLastActive(timestamp: number) {
        this.lastActiveTimestamp = timestamp;
    }

    incrementMessageCount() {
        this.messageCount += 1;
    }

    addVoiceActivity(duration: number) {
        this.voiceActivityDuration += duration;
    }

    // ---------------------
    // Insights Methods
    // ---------------------

    addKeyword(keyword: string) {
        this.keywords.add(keyword.toLowerCase());
    }

    addAlias(alias: string) {
        if (!this.aliases.includes(alias)) {
            this.aliases.push(alias);
        }
    }

    addInsight(key: string, value: any) {
        this.insights[key] = value;
    }

    setSentimentScore(score: number) {
        this.sentimentScore = Math.max(-1, Math.min(score, 1)); // Clamp between -1 and 1
    }

    setToxicityScore(score: number) {
        this.toxicityScore = Math.max(0, Math.min(score, 1)); // Clamp between 0 and 1
    }

    // ---------------------
    // GuildMember Updates
    // ---------------------

    updateGuildMember(guildMember: GuildMember) {
        if (this.guildMember.user.username !== guildMember.user.username) {
            this.addAlias(guildMember.user.username); // Add new username to aliases
        }

        if (this.guildMember.displayName !== guildMember.displayName) {
            this.addAlias(guildMember.displayName); // Add new display name to aliases
        }

        this.guildMember = guildMember;
    }

    // ---------------------
    // Relationship Methods
    // ---------------------

    addRelationshipStrength(userId: string, connection: UserConnection) {
        if (!this.relationshipStrengths.has(userId)) {
            this.relationshipStrengths.set(userId, []);
        }
        this.relationshipStrengths.get(userId)!.push(connection);
    }

    // ---------------------
    // Serialization
    // ---------------------

    toJSON(network: RelationshipNetwork) {
        const closestRelationships = network.getClosestRelationships(
            this.id,
            5,
        );
        return {
            id: this.id,
            displayName: this.guildMember.displayName,
            aliases: this.aliases,
            keywords: Array.from(this.keywords),
            activity: {
                messageCount: this.messageCount,
                lastActive: this.lastActiveTimestamp
                    ? new Date(this.lastActiveTimestamp).toISOString()
                    : "Never active",
                voiceActivityDuration: `${this.voiceActivityDuration} seconds`,
            },
            insights: {
                sentimentScore: this.sentimentScore.toFixed(2),
                toxicityScore: this.toxicityScore.toFixed(2),
                ...this.insights,
            },
            closestRelationships,
        };
    }
}
