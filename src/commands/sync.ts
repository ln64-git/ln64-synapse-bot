import { ChatInputCommandInteraction, TextChannel } from "npm:discord.js";
import { SlashCommandBuilder } from "npm:@discordjs/builders";
import { MongoClient } from "npm:mongodb";
import {
    syncChannelToDatabase,
    syncGuildToDatabase,
    syncMembersToDatabase,
    syncMessagesToDatabase,
} from "../discord/guild-utils.ts";
import { ChannelType } from "npm:discord-api-types/v10";

export const data = new SlashCommandBuilder()
    .setName("sync")
    .setDescription("Sync Mongo Database");

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const mongoUri = Deno.env.get("MONGO_URI") || "";
    const client = new MongoClient(mongoUri);

    try {
        await client.connect();
        console.log("Connected to MongoDB!");

        const guild = interaction.guild!;
        const dbName = `discord_data_${
            guild.name.replace(/\s+/g, "_").toLowerCase()
        }`;
        const db = client.db(dbName);

        // Step 1: Sync Guild Data
        await syncGuildToDatabase(guild, db);
        console.log("Guild data synchronized.");

        // Step 2: Sync Members
        await syncMembersToDatabase(guild, db);
        console.log("Member data synchronized.");

        // Step 3: Sync Channels
        for (const [channelId, channel] of guild.channels.cache.entries()) {
            if (channel.type === ChannelType.GuildText) {
                await syncChannelToDatabase(channel, db);
            }
        }
        console.log("Channel data synchronized.");

        // Step 4: Sync Messages for a Specific Channel
        const channelId = "1005840969243041902";
        const channel = guild.channels.cache.get(channelId);
        if (channel?.type === ChannelType.GuildText) {
            await syncMessagesToDatabase(channel as TextChannel, db);
            console.log("Message data synchronized.");
        } else {
            console.error(
                `Channel with ID ${channelId} not found or is not text-based.`,
            );
        }

        await interaction.editReply(
            "Guild data synchronized to MongoDB successfully!",
        );
    } catch (error) {
        console.error("Error connecting to MongoDB:", error);
        await interaction.editReply(
            `Error executing command: ${(error as Error).message}`,
        );
    } finally {
        await client.close();
    }
}
