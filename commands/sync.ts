import { ChatInputCommandInteraction } from "npm:discord.js";
import { SlashCommandBuilder } from "npm:@discordjs/builders";

export const data = new SlashCommandBuilder()
    .setName("sync")
    .setDescription("Sync Mongo Database");

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply("Test command executed successfully!");
}
