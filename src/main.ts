// main.ts

import { Client } from "discord.js";
import { REST } from "@discordjs/rest";
import dotenv from "dotenv";
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v9";
import { GatewayIntentBits, Routes } from "discord-api-types/v10";
import type { Interaction } from "discord.js";
import { getMessageById } from "./lib/discord/discord";
import { extractMediaAttachments } from "./utils/generateAttachment";
import { readdir } from "fs/promises";
import { join, relative } from "path";
import { deriveConversations } from "./utils/deriveConversations";

dotenv.config();

const botToken = process.env.BOT_TOKEN!;
const clientId = process.env.CLIENT_ID!;
const guildId = process.env.GUILD_ID!;
if (!botToken || !clientId || !guildId) {
  throw new Error(
    "Missing BOT_TOKEN, CLIENT_ID, or GUILD_ID environment variables.",
  );
}

interface ExtendedClient extends Client {
  commands: Map<
    string,
    { data: RESTPostAPIApplicationCommandsJSONBody; execute: Function }
  >;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
}) as ExtendedClient;

async function main() {
  client.commands = new Map();
  const commands = await loadCommands();
  await registerCommands(commands);

  client.once("ready", async () => {
    console.log(`Logged in as ${client.user?.tag}!`);
    try {
      const guild = await client.guilds.fetch(guildId);
      const message = await getMessageById(guild, "1307503405648052325");
      deriveConversations([message]);
      if (message) {
        extractMediaAttachments(message);
      } else {
        console.error("Message not found");
      }
    } catch (error) {
      console.error("Error fetching guild or processing messages:", error);
    }
  });

  client.on("interactionCreate", handleInteraction);
  await client.login(botToken);
}

main();

async function loadCommands() {
  const commands: RESTPostAPIApplicationCommandsJSONBody[] = [];
  const commandFiles = await readdir(join(process.cwd(), "src/commands"));
  for (const file of commandFiles) {
    if (file.endsWith(".ts")) {
      const { data, execute } = await import(
        `./${
          relative(
            join(process.cwd(), "src"),
            join(process.cwd(), "src/commands", file),
          ).replace(/\\/g, "/")
        }`
      );
      client.commands.set(data.name, { data, execute });
      commands.push(data.toJSON());
    }
  }
  return commands;
}

async function registerCommands(
  commands: RESTPostAPIApplicationCommandsJSONBody[],
) {
  const rest = new REST({ version: "9" }).setToken(botToken);
  try {
    console.log("Started refreshing application (/) commands.");
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });
    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error("Error registering commands:", error);
  }
}

async function handleInteraction(interaction: Interaction) {
  if (!interaction.isCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (error) {
    console.error("Error executing command:", error);
    const replyContent = {
      content: "There was an error executing that command!",
      ephemeral: true,
    };
    interaction.deferred || interaction.replied
      ? await interaction.editReply(replyContent)
      : await interaction.reply(replyContent);
  }
}
