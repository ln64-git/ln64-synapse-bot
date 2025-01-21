import { Message, VoiceState } from "discord.js";
import { RelationshipNetwork } from "./RelationshipNetwork";

export class RelationshipManager {
    constructor(private network: RelationshipNetwork) {}

    async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
        const userId = newState.id;
        const user = this.network.addUser(newState.member!);

        if (!oldState.channelId && newState.channelId) {
            await (await user).trackVoiceActivity(newState.channelId, true); // Joining
        } else if (oldState.channelId && !newState.channelId) {
            await (await user).trackVoiceActivity(oldState.channelId, false); // Leaving
        }
    }

    async processMessages(messages: Message[]): Promise<void> {
        for (const message of messages) {
            let member = message.member;

            if (!member && message.guild) {
                try {
                    // Attempt to fetch the member if it's missing
                    member = await message.guild.members.fetch(
                        message.author.id,
                    );
                } catch (error) {
                    console.warn(
                        `Failed to fetch member for message ID ${message.id} in guild ${message.guild.name}:`,
                        error,
                    );
                    continue;
                }
            }

            if (member) {
                const sender = await this.network.addUser(member);
                await sender.incrementMessageCount();
            } else {
                console.warn(
                    `Message with ID ${message.id} has no member associated even after fetching.`,
                );
            }
        }
    }
}
