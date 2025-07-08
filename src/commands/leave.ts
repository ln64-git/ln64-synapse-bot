import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getVoiceConnection } from "@discordjs/voice";

export const data = new SlashCommandBuilder()
  .setName("leave")
  .setDescription("Bot leaves the voice channel.");

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "This can only be used in a server.", ephemeral: true });
    return;
  }

  const connection = getVoiceConnection(guildId);
  if (!connection) {
    await interaction.reply({ content: "I'm not connected to any voice channel.", ephemeral: true });
    return;
  }

  connection.destroy();

  await interaction.reply({
    content: `Left the voice channel!`,
    ephemeral: true,
  });
}
