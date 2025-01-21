import type { Message } from "discord.js";
import { RelationshipNetwork } from "./RelationshipNetwork";

export class RelationshipManager {
    constructor(private network: RelationshipNetwork) {}

    public async processMessages(messages: Message[]) {
        for (const message of messages) {
            const authorId = message.author.id;

            await this.ensureMemberInNetwork(authorId, message);

            const repliedToUser = message.reference?.messageId
                ? message.mentions.repliedUser?.id
                : null;

            if (repliedToUser) {
                await this.ensureMemberInNetwork(repliedToUser, message);
                this.addInteraction(authorId, repliedToUser, message, "reply");
            }

            const mentionedUsers = message.mentions.users.map((user) =>
                user.id
            );

            for (const mentionedId of mentionedUsers) {
                if (mentionedId === repliedToUser) continue;

                await this.ensureMemberInNetwork(mentionedId, message);
                this.addInteraction(authorId, mentionedId, message, "mention");
            }
        }

        // After processing all messages, update closest relationships for each user
        this.updateAllClosestRelationships();
    }

    private updateAllClosestRelationships() {
        for (const [userId, user] of this.network.users) {
            const closestRelationships = this.network.getClosestRelationships(
                userId,
                5, // Fetch top 5 closest relationships
            );
            user.setClosestRelationships(closestRelationships);
        }
    }

    private async ensureMemberInNetwork(userId: string, message: Message) {
        if (!this.network.hasUser(userId) && message.guild) {
            try {
                const member = await message.guild.members.fetch(userId);
                this.network.addUser(member);
            } catch (error) {
                console.error(`Error fetching member ${userId}:`, error);
            }
        }
    }

    private addInteraction(
        senderId: string,
        receiverId: string,
        message: Message,
        interactionType: "mention" | "reply" | "other",
    ) {
        this.network.addInteraction(senderId, receiverId, {
            content: message.content,
            timestamp: message.createdTimestamp,
            type: interactionType,
        });
    }
}
