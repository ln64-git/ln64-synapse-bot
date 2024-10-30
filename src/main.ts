import { Client } from "npm:discord.js";
import { REST } from "npm:@discordjs/rest";
import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";
import { join, relative } from "https://deno.land/std@0.224.0/path/mod.ts";
import "https://deno.land/x/dotenv@v3.2.2/load.ts";
import type { RESTPostAPIApplicationCommandsJSONBody } from "npm:discord-api-types/v9";
import { GatewayIntentBits, Routes } from "npm:discord-api-types/v10";
import { syncDatabase } from "./neo4j/neo4j.ts";


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
  ],
});

client.commands = new Map();
for await (
  const entry of walk(join(Deno.cwd(), "src/commands"), {
    exts: [".ts"],
    includeDirs: false,
  })
) {
  const { data, execute } = await import(
    `./${relative(join(Deno.cwd(), "src"), entry.path).replace(/\\/g, "/")}`
  );
  client.commands.set(data.name, { data, execute });
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user?.tag}!`);
  const guild = client.guilds.cache.get(guildId);
  if (guild) {
    syncDatabase(guild);
  } else {
    console.error("Guild not found.");
  }
});

client.on("interactionCreate", async (interaction) => {
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
});

async function registerCommands() {
  const commands: RESTPostAPIApplicationCommandsJSONBody[] = [];
  const commandFiles = walk(join(Deno.cwd(), "src/commands"), {
    exts: [".ts"],
    includeDirs: false,
  });
  for await (const entry of commandFiles) {
    const { data } = await import(
      `./${relative(join(Deno.cwd(), "src"), entry.path).replace(/\\/g, "/")}`
    );
    commands.push(data.toJSON());
  }
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

registerCommands().then(() => client.login(botToken));
