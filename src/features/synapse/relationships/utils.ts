import type { Message } from "discord.js";
import type { RelationshipNetwork } from "./RelationshipNetwork";

export async function processMessages(
    network: RelationshipNetwork,
    messages: Message[],
): Promise<void> {
    for (const message of messages) {
        const member = message.member ??
            await message.guild?.members.fetch(message.author.id).catch(() =>
                null
            );
        if (!member) {
            console.warn(
                `Skipping message ${message.id}: No associated member.`,
            );
            continue;
        }

        const sender = network.getUser(member.id) ??
            await network.addUser(member);
        if (await sender.hasDifferentData(member)) {
            console.log(`Updating ${sender.discordGuildMember.displayName}...`);
            await sender.updateUserData();
        }

        await sender.incrementMessageCount();
    }
}
