import { REST, Routes } from "discord.js";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

export async function loadCommands(commandsCollection: any) {
    const commands = [];
    const commandsPath = path.join(__dirname, "../commands");
    const commandFiles = fs.readdirSync(commandsPath).filter((file) =>
        file.endsWith(".ts") || file.endsWith(".js")
    );

    for (const file of commandFiles) {
        const command = await import(`../commands/${file}`);
        if ("data" in command && "execute" in command) {
            commandsCollection.set(command.data.name, command);
            commands.push(command.data.toJSON());
        } else {
            console.warn(`Skipping ${file}: missing 'data' or 'execute'`);
        }
    }

    // Register commands with Discord API
    const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN!);
    try {
        console.log(`Refreshing ${commands.length} application (/) commands.`);
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID!),
            { body: commands },
        );
        console.log("Slash commands registered successfully.");
    } catch (error) {
        console.error("Failed to register commands:", error);
    }
}
