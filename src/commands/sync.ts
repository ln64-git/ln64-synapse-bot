import { ChatInputCommandInteraction, TextChannel } from "npm:discord.js";
import { SlashCommandBuilder } from "npm:@discordjs/builders";
import neo4j from "npm:neo4j-driver";
import { ChannelType } from "npm:discord-api-types/v10";
import { syncMessages } from "../discord/guild-utils.ts";

// Retrieve environment variables directly
const neo4jUri = Deno.env.get("NEO4J_URI");
const neo4jUser = Deno.env.get("NEO4J_USERNAME");
const neo4jPassword = Deno.env.get("NEO4J_PASSWORD");

export const data = new SlashCommandBuilder()
    .setName("sync")
    .setDescription("Sync Neo4j Database")
    .addStringOption(option =>
        option.setName("channelid")
            .setDescription("The ID of the channel to sync")
            .setRequired(true)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    if (!neo4jUri || !neo4jUser || !neo4jPassword) {
        console.error("Error: Missing required environment variables.");
        Deno.exit(1);
    }

    const driver = neo4j.driver(
        neo4jUri,
        neo4j.auth.basic(neo4jUser, neo4jPassword),
    );

    try {
        const session = driver.session();
        const guild = interaction.guild!;
        const channel = guild.channels.cache.get("1271944226950611076"); // latine-chat

        if (!channel || channel.type !== ChannelType.GuildText) {
            await interaction.editReply("Invalid channel ID or the channel is not a text channel.");
            return;
        }

        console.log("Connected to Neo4j!");
        await syncMessages(channel as TextChannel, session);

        await interaction.editReply(
            "Channel messages synchronized to Neo4j successfully!",
        );
    } catch (error) {
        console.error("Error syncing to Neo4j:", error);
        const errorMessage = error instanceof Error
            ? error.message
            : String(error);
        await interaction.editReply(
            `Error executing command: ${errorMessage}`,
        );
    } finally {
        await driver.close();
    }
}
