// src/utils/loadCommands.ts
import { Client, REST, Routes } from "discord.js";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

export async function loadCommands(client: Client, commandsCollection: any) {
    // 1) Gather commands from /commands
    const commands = [];
    const commandsPath = path.join(__dirname, "../commands");
    const commandFiles = fs
        .readdirSync(commandsPath)
        .filter((file) => file.endsWith(".ts") || file.endsWith(".js"));

    for (const file of commandFiles) {
        const command = await import(`../commands/${file}`);
        if ("data" in command && "execute" in command) {
            commandsCollection.set(command.data.name, command);
            commands.push(command.data.toJSON());
        } else {
            console.warn(`Skipping ${file}: missing 'data' or 'execute'`);
        }
    }

    // 2) Register these commands as guild commands for each guild
    const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN!);
    await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID!),
        { body: [] },
    );
    const clientId = process.env.CLIENT_ID!;
    const guilds = await client.guilds.fetch();
    console.log(`Registering slash commands in ${guilds.size} guild(s).`);

    for (const [guildId] of guilds) {
        try {
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
                body: commands,
            });
            console.log(`✓ Registered commands in guild ${guildId}`);
        } catch (error) {
            console.error(
                `Failed to register commands in guild ${guildId}:`,
                error,
            );
        }
    }


    console.log("All guild slash commands registered successfully.");
}
