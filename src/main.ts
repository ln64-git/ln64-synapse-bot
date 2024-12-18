// main.ts

import { Client, GatewayIntentBits, type Interaction, REST } from "discord.js";
import dotenv from "dotenv";
import { Routes } from "discord-api-types/v10";
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v9";
import { readdir } from "fs/promises";
import { join, relative } from "path";
import logger from "./function/logger";
import { getFiresideMessages } from "./lib/discord/discord";
import {
  ConversationManager,
  processMessageBatch,
} from "./function/conversationManager";
import { saveAllConversationsToFile } from "./utils/utils";
import { speakVoiceCall } from "./function/speakVoiceCall";

dotenv.config();

const botToken = process.env.BOT_TOKEN!;
const clientId = process.env.CLIENT_ID!;
const guildId = process.env.GUILD_ID!;

if (!botToken || !clientId || !guildId) {
  throw new Error(
    "Missing BOT_TOKEN, CLIENT_ID, or GUILD_ID environment variables.",
  );
}

// Extend Client to include a `commands` property
class ExtendedClient extends Client {
  commands: Map<
    string,
    { data: RESTPostAPIApplicationCommandsJSONBody; execute: Function }
  > = new Map();
}

const client = new ExtendedClient({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageTyping,
  ],
});

async function main() {
  const commands = await loadCommands();
  await registerCommands(commands);

  client.once("ready", async () => {
    const messageId = "1307921354661822514";
    const channelId = "1004111008337502270";
    const userId = "487026109083418642";
    const guild = await client.guilds.fetch(guildId);

    console.log(`Logged in as ${client.user?.tag}!`);
    try {
      const guild = await client.guilds.fetch(guildId);
      const firesideMessages = await getFiresideMessages(guild);
      const conversationManager = new ConversationManager();
      const conversations = await processMessageBatch(
        firesideMessages,
        conversationManager,
      );
      await saveAllConversationsToFile(conversations);

      await speakVoiceCall(guild, client);
      await logger(client);
    } catch (error) {
      console.error("Error fetching guild or processing messages:", error);
    }
  });

  client.on("interactionCreate", handleInteraction);
  await client.login(botToken);
}

main().catch((err) => {
  console.error("Error starting the bot:", err);
});

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
  const rest = new REST({ version: "10" }).setToken(botToken);
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
    // Pass client into the command execution
    await command.execute(interaction, client);
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
