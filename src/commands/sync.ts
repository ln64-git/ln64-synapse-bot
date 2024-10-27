import { ChatInputCommandInteraction } from "npm:discord.js";
import { SlashCommandBuilder } from "npm:@discordjs/builders";
import { MongoClient } from "npm:mongodb";

export const data = new SlashCommandBuilder()
    .setName("sync")
    .setDescription("Sync Mongo Database");

export async function execute(interaction: ChatInputCommandInteraction) {
    const mongoUri = Deno.env.get("MONGO_URI") || "";
    const client = new MongoClient(mongoUri);

    try {
        // Acknowledge the interaction immediately
        await interaction.deferReply();

        await client.connect();
        const db = client.db("sample_mflix");
        const collection = db.collection("movies");

        // Find all documents in the collection
        const documents = await collection.find({}).toArray();
        console.log("Documents:", documents);

        // Edit the reply with the result
        await interaction.editReply("Documents retrieved successfully!");
    } catch (error) {
        console.error("Error connecting to MongoDB:", error);
        await interaction.editReply(
            `Error executing command: ${(error as Error).message}`,
        );
    } finally {
        await client.close();
    }
}