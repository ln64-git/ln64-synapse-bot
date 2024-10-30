import { ChatInputCommandInteraction } from "npm:discord.js";
import { SlashCommandBuilder } from "npm:@discordjs/builders";

export const data = new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with Pong!");

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply("Pong!");
}
