// src/commands/test.ts

import { SlashCommandBuilder } from "@discordjs/builders";
import { ChatInputCommandInteraction, GuildMember } from "discord.js";
import { validateInteraction } from "../discord/guild-utils";
import { connectToDatabase } from "../database/db";

export const data = new SlashCommandBuilder()
    .setName("test")
    .setDescription(
        "nuke server.",
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    const validationResponse = await validateInteraction(interaction);
    if (typeof validationResponse === "string") {
        return await interaction.editReply(validationResponse);
    }
    const { guild, user, days } = validationResponse;

    await connectToDatabase();
    // createDatabase("discord");
}
