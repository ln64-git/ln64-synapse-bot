import { Client, GatewayIntentBits, Collection, REST, Routes } from "discord.js";
import { config } from "dotenv";
import * as fs from 'fs';
import * as path from 'path';


config(); // Load .env variables

// Register commands dynamically for a specific guild (or globally)
async function registerCommands() {
  const { BOT_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

  if (!BOT_TOKEN || !CLIENT_ID || !GUILD_ID) {
    throw new Error("Missing BOT_TOKEN, CLIENT_ID, or GUILD_ID environment variables.");
  }

  const commands = [];
  const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.ts'));

  for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    commands.push(command.data.toJSON()); // Push the command data in a format Discord expects
  }

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

  try {
    console.log("Started refreshing application (/) commands.");

    // Register commands for a specific guild
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });

    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error("Error registering commands: ", error);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Create a collection to store commands
client.commands = new Collection();

// Load command files into client.commands collection
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.ts'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.data.name, command); // Make sure to set the command using its name
}

// When the bot is ready
client.once('ready', () => {
  console.log(`Logged in as ${client.user?.tag}!`);
});

// Event listener for slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    await interaction.reply({ content: 'There was an error executing that command!', ephemeral: true });
  }
});

// Register commands and then log in to Discord
registerCommands().then(() => {
  client.login(process.env.BOT_TOKEN); // Log in to Discord after command registration
});
