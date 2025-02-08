import { GuildMember, Message, VoiceState } from "discord.js";
import { RelationshipNetwork } from "./RelationshipNetwork";

export class RelationshipManager {
    constructor(private network: RelationshipNetwork) {}

    async processMessages(messages: Message[]): Promise<void> {
        for (const message of messages) {
            let member = message.member;
            if (!member && message.guild) {
                try {
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
            if (!member) {
                console.warn(
                    `Message ID ${message.id} has no associated member.`,
                );
                continue;
            }

            let sender = this.network.getUser(member.id);
            if (!sender) {
                sender = await this.network.addUser(member);
            }

            const shouldUpdate = await sender.hasDifferentData(member);
            if (shouldUpdate) {
                console.log(
                    `hasDifferentData found, updateing.. ${sender.discordGuildMember.displayName}`,
                );
                await sender.updateUserData();
            }

            await sender.incrementMessageCount();
        }
    }
}
