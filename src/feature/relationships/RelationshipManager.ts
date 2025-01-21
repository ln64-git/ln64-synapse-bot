import type { GuildMember, Message, VoiceState } from "discord.js";
import { RelationshipNetwork } from "./RelationshipNetwork";

export class RelationshipManager {
    constructor(private network: RelationshipNetwork) {}

    handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
        const userId = newState.id; // Get the user ID
        const user = this.network.getUser(userId);

        // Ensure the user exists in the relationship network
        if (!user) {
            const member = newState.member || oldState.member;
            if (member) this.network.addUser(member);
            return;
        }

        // User joined a voice channel
        if (!oldState.channelId && newState.channelId) {
            user.startVoiceActivity(newState.channelId);
        }

        // User switched voice channels
        if (
            oldState.channelId && newState.channelId &&
            oldState.channelId !== newState.channelId
        ) {
            user.endVoiceActivity(oldState.channelId);
            user.startVoiceActivity(newState.channelId);
        }

        // User left a voice channel
        if (oldState.channelId && !newState.channelId) {
            user.endVoiceActivity(oldState.channelId);
        }
    }

    public async processMessages(messages: Message[]) {
        for (const message of messages) {
            const authorId = message.author.id;

            await this.ensureMemberInNetwork(authorId, message);

            const repliedToUser = message.reference?.messageId
                ? message.mentions.repliedUser?.id
                : null;

            // Update the sender's activity metrics
            this.updateUserActivity(authorId, message.createdTimestamp);

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
    }

    private async ensureMemberInNetwork(userId: string, message: Message) {
        const existingUser = this.network.getUser(userId);
        if (!existingUser && message.guild) {
            try {
                const member = await message.guild.members.fetch(userId);
                this.network.addUser(member);
            } catch (error) {
                console.error(`Error fetching member ${userId}:`, error);
            }
        } else if (existingUser && message.guild) {
            try {
                const currentMember = await message.guild.members.fetch(userId);
                existingUser.updateGuildMember(currentMember); // Update GuildMember and aliases
            } catch (error) {
                console.error(`Error updating member ${userId}:`, error);
            }
        }
    }

    public async addGuildMembers(guild: any) {
        const members = await guild.members.fetch();
        members.forEach((member: any) => {
            this.network.addUser(member);
        });
    }

    private updateUserActivity(userId: string, timestamp: number) {
        const user = this.network.getUser(userId);
        if (user) {
            user.incrementMessageCount(); // Increment message count
            user.updateLastActive(timestamp); // Update last active timestamp
        }
    }

    private addInteraction(
        senderId: string,
        receiverId: string,
        message: Message,
        interactionType: "mention" | "reply" | "other",
    ) {
        const senderUser = this.network.getUser(senderId);
        const receiverUser = this.network.getUser(receiverId);

        if (!senderUser || !receiverUser) return;

        // Add the interaction to the relationship network
        this.network.addInteraction(senderId, receiverId, {
            content: message.content,
            timestamp: message.createdTimestamp,
            type: interactionType,
        });

        // Update relationship strengths for the sender
        const senderConnection = this.network.ensureRelationship(
            senderId,
            receiverId,
        );
        senderUser.addRelationshipStrength(receiverId, senderConnection);

        // Update relationship strengths for the receiver
        const receiverConnection = this.network.ensureRelationship(
            receiverId,
            senderId,
        );
        receiverUser.addRelationshipStrength(senderId, receiverConnection);
    }
}
