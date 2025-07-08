import { SlashCommandBuilder } from "@discordjs/builders";
import { ChatInputCommandInteraction } from "discord.js";
import type { Db } from "mongodb";

export const data = new SlashCommandBuilder()
  .setName("block")
  .setDescription("Block a user from joining voice channels with you")
  .addUserOption(option =>
    option.setName("user").setDescription("The user to block").setRequired(true)
  );

export async function execute(
  interaction: ChatInputCommandInteraction & { client: any }
) {
  const userToBlock = interaction.options.getUser("user");
  const blockerId = interaction.user.id;
  if (userToBlock?.id === blockerId) {
    await interaction.reply({ content: "You can't block yourself.", ephemeral: true });
    return;
  }

  const db: Db = interaction.client.bot.db; // Assumes you attach your Bot instance to client
  const alreadyBlocked = await db.collection("vcBlocks").findOne({
    blocker: blockerId,
    blocked: userToBlock?.id,
  });

  if (alreadyBlocked) {
    await interaction.reply({ content: "User is already blocked.", ephemeral: true });
    return;
  }

  await db.collection("vcBlocks").insertOne({
    blocker: blockerId,
    blocked: userToBlock?.id,
  });

  await interaction.reply({ content: `You have blocked <@${userToBlock?.id}> from joining VCs with you.`, ephemeral: true });
}
