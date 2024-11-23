// main.ts

import { Client } from "discord.js";
import { REST } from "@discordjs/rest";
import dotenv from "dotenv";
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v9";
import { GatewayIntentBits, Routes } from "discord-api-types/v10";
import type { Interaction } from "discord.js";
import { readdir } from "fs/promises";
import { join, relative } from "path";
import { generateConversations } from "./function/generateConversations";
import { extractMediaAttachments } from "./function/generateAttachment";
import { ask } from "./function/ask";
import { syncDatabase } from "./lib/neo4j/neo4j";

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
      // const messageId = "1307921354661822514";
      // const channelId = "1004111008337502270";
      // const channel = await guild.channels.fetch(channelId);
      // if (channel?.isTextBased()) {
      //   const message = await channel.messages.fetch(messageId);
      //   extractMediaAttachments(message);
      //   console.log(`Fetched message: ${message.content}`);
      // } else {
      //   console.error("Channel is not text-based or does not exist.");
      // }
      // syncDatabase(guild);
      // TODO Sync one day worth of Fireside messages
      // This means I will need to update the neo4j schema
      // neo4j schema should sync guild data with a focus on users and their relationships based off of conversations
      // ask("What is the average number of messages sent per user?");
      // generateConversations(guild);
      syncDatabase(guild);
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
