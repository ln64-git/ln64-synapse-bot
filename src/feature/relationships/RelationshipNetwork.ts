import type { GuildMember } from "discord.js";
import { UserProfile } from "./UserProfile";

export class Interaction {
    constructor(
        public content: string,
        public timestamp: number,
        public type: "mention" | "reply" | "other",
        public sender: string,
        public receiver: string,
    ) {}

    toJSON() {
        return {
            content: this.content,
            timestamp: new Date(this.timestamp).toISOString(),
            type: this.type,
            sender: this.sender,
            receiver: this.receiver,
        };
    }
}

export class UserConnection {
    public interactions: Interaction[] = [];

    constructor(public userId: string) {}

    addInteraction(interaction: Interaction) {
        this.interactions.push(interaction);
    }

    getTotalInteractions(): number {
        return this.interactions.length;
    }

    getInteractionsByType(type: "mention" | "reply" | "other"): Interaction[] {
        return this.interactions.filter((interaction) =>
            interaction.type === type
        );
    }
}

export class RelationshipNetwork {
    public users: Map<string, UserProfile> = new Map();
    private relationships: Map<string, Map<string, UserConnection>> = new Map();

    addUser(member: GuildMember): void {
        if (!this.users.has(member.id)) {
            this.users.set(
                member.id,
                new UserProfile(member.id, member.user.username, member),
            );
        }
    }

    getUser(userId: string): UserProfile | undefined {
        return this.users.get(userId);
    }

    getUsername(userId: string): string {
        return this.users.get(userId)?.guildMember.user.username || "Unknown";
    }

    hasUser(userId: string): boolean {
        return this.users.has(userId);
    }

    getTotalVoiceTime(userId: string, serverId: string): number {
        const user = this.getUser(userId);
        return user?.voiceCallDurations.get(serverId) || 0;
    }

    getInteractionTime(
        userId: string,
        serverId: string,
        otherUserId: string,
    ): number {
        const user = this.getUser(userId);
        const interactions = user?.voiceInteractionDurations.get(serverId);
        return interactions?.get(otherUserId) || 0;
    }

    getMostInteractedUsers(
        userId: string,
        serverId: string,
        limit: number = 5,
    ): { userId: string; duration: number }[] {
        const user = this.getUser(userId);
        const interactions = user?.voiceInteractionDurations.get(serverId);
        if (!interactions) return [];

        return Array.from(interactions.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, limit)
            .map(([id, duration]) => ({ userId: id, duration }));
    }
    getClosestRelationships(userId: string, limit: number = 5) {
        const connections = this.relationships.get(userId);

        if (!connections) return [];

        // Map and sort the relationships
        return Array.from(connections.entries())
            .filter(([relatedUserId]) => relatedUserId !== userId) // Exclude self-interaction
            .map(([relatedUserId, connection]) => {
                const totalInteractions = connection.getTotalInteractions();
                const username = this.getUsername(relatedUserId); // Fetch correct username
                return {
                    userId: relatedUserId,
                    username,
                    totalInteractions,
                };
            })
            .sort((a, b) => b.totalInteractions - a.totalInteractions) // Sort by interactions
            .slice(0, limit); // Take top N
    }

    
    ensureRelationship(senderId: string, receiverId: string): UserConnection {
        if (!this.relationships.has(senderId)) {
            this.relationships.set(senderId, new Map());
        }

        const connections = this.relationships.get(senderId)!;

        if (!connections.has(receiverId)) {
            connections.set(receiverId, new UserConnection(receiverId));
        }

        return connections.get(receiverId)!;
    }

    addInteraction(
        senderId: string,
        receiverId: string,
        interactionData: { content: string; timestamp: number; type: string },
    ): void {
        const sender = this.getUser(senderId);
        const receiver = this.getUser(receiverId);

        if (!sender || !receiver) {
            throw new Error(`Sender or receiver not found in the network.`);
        }

        const interaction = new Interaction(
            interactionData.content,
            interactionData.timestamp,
            interactionData.type as "mention" | "reply" | "other",
            sender.guildMember.user.username,
            receiver.guildMember.user.username,
        );

        // Add interaction to both sides
        this.ensureRelationship(senderId, receiverId).addInteraction(
            interaction,
        );
        this.ensureRelationship(receiverId, senderId).addInteraction(
            interaction,
        );
    }
}
