import type { GuildMember } from "discord.js";
import { User } from "./User";

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
    public users: Map<string, User> = new Map();
    private relationships: Map<string, Map<string, UserConnection>> = new Map();

    addUser(member: GuildMember) {
        if (!this.users.has(member.id)) {
            this.users.set(
                member.id,
                new User(member.id, member.user.username, member),
            );
        }
    }

    getUser(userId: string): User | undefined {
        return this.users.get(userId);
    }

    getUsername(userId: string): string {
        return this.users.get(userId)?.username || "Unknown";
    }

    hasUser(userId: string): boolean {
        return this.users.has(userId);
    }

    getClosestRelationships(
        userId: string,
        topN: number = 5,
    ): UserConnection[] {
        const connections = this.relationships.get(userId);
        if (!connections) return [];

        // Sort connections by the total number of interactions
        return Array.from(connections.values())
            .sort((a, b) => b.getTotalInteractions() - a.getTotalInteractions())
            .slice(0, topN);
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
    ) {
        const sender = this.getUser(senderId);
        const receiver = this.getUser(receiverId);

        if (!sender || !receiver) {
            throw new Error(`Sender or receiver not found in the network.`);
        }

        const interaction = new Interaction(
            interactionData.content,
            interactionData.timestamp,
            interactionData.type as "mention" | "reply" | "other",
            sender.username,
            receiver.username,
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
