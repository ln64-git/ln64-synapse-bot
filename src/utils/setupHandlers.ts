import { Client, Events, type Interaction } from "discord.js";
import { Db } from "mongodb";

export function initializeClientHandlers(client: Client, commands: any, db: Db) {
    client.once(Events.ClientReady, () => {
        console.log(`Logged in as ${client.user?.tag}!`);
    });

    client.on(Events.InteractionCreate, async (interaction: Interaction) => {
        if (!interaction.isCommand()) return;

        const command = commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, { db, client });
        } catch (error) {
            console.error("Error executing command:", error);
            const replyContent = {
                content: "An error occurred.",
                ephemeral: true,
            };
            interaction.deferred || interaction.replied
                ? await interaction.editReply(replyContent)
                : await interaction.reply(replyContent);
        }
    });
}
