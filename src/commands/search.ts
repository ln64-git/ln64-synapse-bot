import { ChatInputCommandInteraction } from "npm:discord.js";
import { SlashCommandBuilder } from "npm:@discordjs/builders";
import { MongoClient } from "npm:mongodb@5.6.0";

export const data = new SlashCommandBuilder()
    .setName("search")
    .setDescription("perform a vector search")
    .addStringOption(option => 
        option.setName("query")
            .setDescription("The query to search for")
            .setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const mongoUri = Deno.env.get("MONGO_URI") || "";
    const client = new MongoClient(mongoUri);

    try {
        await client.connect();
        console.log("Connected to MongoDB!");

        const database = client.db("discord_data_the_hearth");
        const coll = database.collection("embedded_movies");

        await interaction.editReply("Test command executed successfully!");
    } catch (error) {
        console.error("Error executing test command:", error);
        await interaction.editReply(
            `Error executing command: ${(error as Error).message}`,
        );
    }
}

