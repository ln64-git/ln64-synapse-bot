import type { GuildMember } from "discord.js";
import type {
    RelationshipNetwork,
    UserConnection,
} from "./RelationshipNetwork";

type VoiceActivity = {
    start: number; // Timestamp (milliseconds) when the activity started
    duration: number; // Total duration (milliseconds) spent in the channel
};

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

    // Voice activity tracking
    public voiceActivity: Record<string, VoiceActivity> = {};
    public voiceCallDurations: Map<string, number> = new Map(); // Server ID -> total duration in seconds
    public voiceInteractionDurations: Map<string, Map<string, number>> =
        new Map(); // Server ID -> (User ID -> time spent together in seconds)

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
    // Voice Status Updates
    // ---------------------

    startVoiceActivity(channelId: string) {
        if (!this.voiceActivity[channelId]) {
            this.voiceActivity[channelId] = { start: Date.now(), duration: 0 };
        }
    }

    endVoiceActivity(channelId: string) {
        const activity = this.voiceActivity[channelId];
        if (activity) {
            activity.duration += Date.now() - activity.start;
            delete this.voiceActivity[channelId];
        }
    }

    getVoiceActivityDuration(channelId: string): string {
        const activity = this.voiceActivity[channelId];
        const totalDuration = activity ? activity.duration : 0;
        const hours = Math.floor(totalDuration / 3600000);
        const minutes = Math.floor((totalDuration % 3600000) / 60000);
        const seconds = Math.floor((totalDuration % 60000) / 1000);
        return `${hours}h ${minutes}m ${seconds}s`;
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
                voiceActivityDuration: Object.fromEntries(
                    this.voiceCallDurations.entries(),
                ),
            },
            voiceInteractions: Object.fromEntries(
                Array.from(this.voiceInteractionDurations.entries()).map(
                    ([serverId, interactions]) => [
                        serverId,
                        Object.fromEntries(interactions.entries()),
                    ],
                ),
            ),
            insights: {
                sentimentScore: this.sentimentScore.toFixed(2),
                toxicityScore: this.toxicityScore.toFixed(2),
                ...this.insights,
            },
            closestRelationships,
        };
    }
}
