import { Client } from "npm:discord.js";
import { REST } from "npm:@discordjs/rest";
import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";
import { join, relative } from "https://deno.land/std@0.224.0/path/mod.ts";
import "https://deno.land/x/dotenv@v3.2.2/load.ts";
import type { RESTPostAPIApplicationCommandsJSONBody } from "npm:discord-api-types/v9";
import { GatewayIntentBits, Routes } from "npm:discord-api-types/v10";

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
    const guildId = Deno.env.get("GUILD_ID");
    if (!guildId) {
      throw new Error("GUILD_ID is not set in environment variables.");
    }
    try {
      const guild = await client.guilds.fetch(guildId);
      // await syncDatabase(guild);
      await getFiresideMessages(guild);
    } catch (error) {
      console.error("Error fetching guild or syncing database:", error);
    }
  });

  client.on("interactionCreate", handleInteraction);
  client.on("voiceStateUpdate", handleVoiceStateUpdate);
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

import type { Interaction, VoiceState } from "npm:discord.js";
import { getFiresideMessages } from "./utils/conversation.ts";

async function handleVoiceStateUpdate(
  oldState: VoiceState,
  newState: VoiceState,
) {
  const user = newState.member?.user;
  const oldChannel = oldState.channel;
  const newChannel = newState.channel;

  if (user) {
    let action = "";
    let payload = "";

    if (!oldChannel && newChannel) {
      action = "joined";
      payload = `${user.displayName} ${action} ${newChannel.name}`;
    } else if (oldChannel && !newChannel) {
      action = "left";
      payload = `${user.displayName} ${action} ${oldChannel.name}`;
    } else if (oldChannel && newChannel && oldChannel.id !== newChannel.id) {
      action = "moved";
      payload =
        `${user.displayName} ${action} from ${oldChannel.name} to ${newChannel.name}`;
    }

    if (action) {
      const speechRequest = { Text: payload };

      try {
        const response = await fetch("http://localhost:8080/input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(speechRequest),
        });

        if (!response.ok) {
          console.error(
            "Failed to send voice state update:",
            response.statusText,
          );
        }
      } catch (error) {
        console.error("Error sending voice state update:", error);
      }
    }
  }
}
