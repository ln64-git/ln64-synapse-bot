import type { GuildMember } from "discord.js";
import type { UserConnection } from "./RelationshipNetwork";

export class User {
    public keywords: Set<string> = new Set();
    public aliases: string[] = [];
    public closestRelationships: UserConnection[] = [];
    public insights: Record<string, any> = {};

    constructor(
        public id: string,
        public username: string,
        public guildMember: GuildMember,
    ) {}

    addKeyword(keyword: string) {
        this.keywords.add(keyword.toLowerCase());
    }

    addAlias(alias: string) {
        if (!this.aliases.includes(alias)) {
            this.aliases.push(alias);
        }
    }

    setClosestRelationships(relationships: UserConnection[]) {
        this.closestRelationships = relationships;
    }

    addInsight(key: string, value: any) {
        this.insights[key] = value;
    }

    toJSON(network: { getUsername: (userId: string) => string }) {
        return {
            id: this.id,
            username: this.username,
            keywords: Array.from(this.keywords),
            aliases: this.aliases,
            closestRelationships: this.closestRelationships.map((rel) => ({
                userId: rel.userId,
                username: network.getUsername(rel.userId), // Add username here
                totalInteractions: rel.getTotalInteractions(),
            })),
            insights: this.insights,
        };
    }
}
