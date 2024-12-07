import { ChatInputCommandInteraction, Client } from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";

export const data = new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with Pong!");

export async function execute(
    interaction: ChatInputCommandInteraction,
) {
    // Now you can access the `client` directly if needed
    console.log(`Command executed by ${interaction.user.tag}`);
    await interaction.reply("Pong!");
}
