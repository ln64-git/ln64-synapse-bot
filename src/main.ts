// main.ts

import { Client } from "npm:discord.js";
import { REST } from "npm:@discordjs/rest";
import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";
import { join, relative } from "https://deno.land/std@0.224.0/path/mod.ts";
import "https://deno.land/x/dotenv@v3.2.2/load.ts";
import type { RESTPostAPIApplicationCommandsJSONBody } from "npm:discord-api-types/v9";
import { GatewayIntentBits, Routes } from "npm:discord-api-types/v10";
import type { Interaction } from "npm:discord.js";
import { getMessageById } from "./lib/discord/discord.ts";
import { extractMediaAttachments } from "./utils/generateAttachment.ts";

const botToken = Deno.env.get("BOT_TOKEN")!;
const clientId = Deno.env.get("CLIENT_ID")!;
const guildId = Deno.env.get("GUILD_ID")!;
if (!botToken || !clientId || !guildId) {
  throw new Error(
    "Missing BOT_TOKEN, CLIENT_ID, or GUILD_ID environment variables.",
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

async function main() {
  client.commands = new Map();
  const commands = await loadCommands();
  await registerCommands(commands);

  client.once("ready", async () => {
    console.log(`Logged in as ${client.user?.tag}!`);
    try {
      // const messages = await getFiresideMessages(guild)
      // const conversations = await deriveConversations(messages)
      // console.log("Conversations derived successfully:", conversations)

      const guild = await client.guilds.fetch(guildId);
      const message = await getMessageById(guild, "1307503405648052325");
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
  // client.on("voiceStateUpdate", handleVoiceStateUpdate);
  await client.login(botToken);
}

main();

async function loadCommands() {
  const commands: RESTPostAPIApplicationCommandsJSONBody[] = [];
  const commandFiles = walk(join(Deno.cwd(), "src/commands"), {
    exts: [".ts"],
    includeDirs: false,
  });
  for await (const entry of commandFiles) {
    const { data, execute } = await import(
      `./${relative(join(Deno.cwd(), "src"), entry.path).replace(/\\/g, "/")}`
    );
    client.commands.set(data.name, { data, execute });
    commands.push(data.toJSON());
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
