// deploy-command.ts
import { REST, Routes } from "discord.js";
import { config } from "dotenv";
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v9";

config();

const { BOT_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!BOT_TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error("Missing environment variables");
}

const commands: RESTPostAPIApplicationCommandsJSONBody[] = [
  {
    name: "init",
    description: "Initializes the bot in the server",
  },
  {
    name: "ping",
    description: "Replies with Pong!",
  },
];

const rest = new REST({ version: "9" }).setToken(BOT_TOKEN);

(async () => {
  try {
    console.log("Started refreshing application (/) commands.");

    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });

    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
})();
