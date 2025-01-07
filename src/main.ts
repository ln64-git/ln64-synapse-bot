import {
  Client,
  GatewayIntentBits,
  type Interaction,
  Message,
  REST,
} from "discord.js";
import dotenv from "dotenv";
import { Routes } from "discord-api-types/v10";
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v9";
import { readdir } from "fs/promises";
import { join, relative } from "path";
import logger, { saveLog } from "./function/logger";
import { getFiresideMessages } from "./lib/discord/discord";
import { speakVoiceCall } from "./function/speakVoiceCall";
import {
  convertToTrimmedMessage,
  getDeletedMessagesByUser2,
} from "./utils/utils";
import { ConversationManager } from "./function/conversationManager";

dotenv.config();

const botToken = process.env.BOT_TOKEN!;
const clientId = process.env.CLIENT_ID!;

if (!botToken || !clientId) {
  throw new Error(
    "Missing BOT_TOKEN or CLIENT_ID environment variables.",
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
    console.log(`Logged in as ${client.user?.tag}!`);

    try {
      // 2) Instantiate the new manager:
      const conversationThreadManager = new ConversationManager();

      // 2. Fetch messages from the "fireside-chat" channel
      const firesideMessages: Message<true>[] = await getFiresideMessages(
        client,
      );

      // 3. Add each message to the ConversationManager using the Two-Level Topic + Thread Approach
      await Promise.all(
        firesideMessages.map((message) =>
          conversationThreadManager.addMessageToTopics(message)
        ),
      );

      // 5) Retrieve the final conversation threads
      const allThreads = conversationThreadManager.getFormattedTopics();

      // 7) Log or store the results
      await saveLog(allThreads, "conversations");

      const data = getDeletedMessagesByUser2("belalugosisdead");
      console.log("Deleted messages data: ", data);

      await speakVoiceCall(client);
      await logger(client);
    } catch (error) {
      console.error("Error initializing conversation threads:", error);
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
    console.log("Started refreshing global application (/) commands.");
    await rest.put(Routes.applicationCommands(clientId), {
      body: commands,
    });
    console.log("Successfully registered global application (/) commands.");
  } catch (error) {
    console.error("Error registering global commands:", error);
  }
}

async function handleInteraction(interaction: Interaction) {
  if (!interaction.isCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
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
