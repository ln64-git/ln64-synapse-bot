import type { Interaction } from "../../types/types";

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
