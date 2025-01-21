import { Db } from "mongodb";
import { UserProfile } from "./UserProfile";
import type { Interaction } from "../../types/types";

export class RelationshipNetwork {
    private users = new Map<string, UserProfile>();

    constructor(private db: Db) {}

    async addUser(guildMember: any): Promise<UserProfile> {
        if (!this.users.has(guildMember.id)) {
            const profile = new UserProfile(guildMember, this.db);
            this.users.set(guildMember.id, profile);
            await profile.save();
        }
        return this.users.get(guildMember.id)!;
    }

    async addInteraction(
        senderId: string,
        receiverId: string,
        interaction: Interaction,
    ): Promise<void> {
        const sender = this.users.get(senderId) ||
            (await UserProfile.load(this.db, senderId));
        const receiver = this.users.get(receiverId) ||
            (await UserProfile.load(this.db, receiverId));

        if (sender && receiver) {
            // Example: Update some relationship-specific property
            console.log(
                `Logged interaction between ${senderId} and ${receiverId}:`,
                interaction.content,
            );
        }
    }
}
