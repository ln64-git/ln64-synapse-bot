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
            const sender = await this.network.addUser(message.member!);
            await sender.incrementMessageCount();
        }
    }
}
