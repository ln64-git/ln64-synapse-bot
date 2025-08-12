import logger from "./utils/logger";
import { Client, Collection, GatewayIntentBits, REST, Routes } from "discord.js";
import { Db, MongoClient } from "mongodb";
import { speakVoiceCall } from "./features/speak-voice-call/speakVoiceCall";
import { initializeClientHandlers } from "./utils/setupHandlers";
import { loadCommands } from "./utils/loadCommands";
import { trackOnline } from "./utils/trackOnline";
import { addSpeechEvent } from "discord-speech-recognition";
import trackVoiceActivity from "./features/availability/trackVoiceActivity";
import { RelationshipNetwork } from "./features/synapse/relationships/RelationshipNetwork";
import { ConversationManager } from "./features/synapse/covnersations/ConversationManager";
import { trackServerAvailability } from "./features/availability/trackServerAvailability";
import { scheduleWeeklyVcActivity } from "./features/availability/weeklyVcActivity";

// TODO 
// - Implement database for users and messages
// - Improve logging system for deleted messages
// - Look over role command 

// IDEAS
// - Users can setup custom vc ping based on member count
// - Users can block other users from entering calls with them
// - Generate custom playlist based on comparing user's last.fm data
// - Queue multiple songs with one command 

export class Bot {
    public client: Client;
    public db!: Db;
    public commands = new Collection<string, any>();
    public relationshipNetwork!: RelationshipNetwork;
    public conversationManager!: ConversationManager; // Add ConversationManager

    constructor(private token: string, private mongoUri: string) {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildPresences,
            ],
        });
        addSpeechEvent(this.client);
    }

    async init() {
        await this.client.login(this.token);
        console.log(`Logged in as ${this.client.user?.tag}!`);
        await this.connectToDatabase();
        this.setupEventHandlers();
        await this.registerCommands();
        console.log("Bot is running!");
    }

    private setupEventHandlers() {
        if (!this.db) {
            console.warn("trackVoiceActivity: database is not initialized yet.");
            return;
        }

        initializeClientHandlers(this.client, this.commands, this.db);

        trackVoiceActivity(this.client, this.db);
        trackServerAvailability(this.client, this.db);
        scheduleWeeklyVcActivity(this.client, this.db);

        speakVoiceCall(this.client);
        // listenVoiceCall(this.client);
        // stayBanned(this.client, this.db);
        logger(this.client);

        const user1Id = process.env.USER_1;
        if (!user1Id) {
            throw new Error(
                "One or both USER_1 and USER_2 environment variables are missing.",
            );
        }
        trackOnline([user1Id], this.client);
    }

    private async connectToDatabase() {
        const mongoClient = new MongoClient(this.mongoUri);
        try {
            await mongoClient.connect();
            this.db = mongoClient.db("discordData");
            console.log("Connected to MongoDB.");
            this.relationshipNetwork = new RelationshipNetwork(this.db);
            this.conversationManager = new ConversationManager(); // Initialize ConversationManager
        } catch (error) {
            console.error("Failed to connect to MongoDB:", error);
            process.exit(1);
        }
    }

    private async registerCommands() {
        const rest = new REST({ version: "10" }).setToken(this.token);
        const commands = await loadCommands(this.client, this.commands);

        const appId = this.client.application?.id;
        if (!appId) {
            throw new Error("Application ID is missing. Make sure the client is fully logged in.");
        }

        try {
            if (process.env.GUILD_ID) {
                // Fast guild-specific deployment for testing
                await rest.put(
                    Routes.applicationGuildCommands(appId, process.env.GUILD_ID),
                    { body: commands },
                );
                console.log(`✅ Slash commands registered to guild ${process.env.GUILD_ID}.`);
            } else {
                // Global deployment (takes up to an hour)
                await rest.put(
                    Routes.applicationCommands(appId),
                    { body: commands },
                );
                console.log("✅ Global slash commands registered.");
            }
        } catch (error) {
            console.error("❌ Error registering slash commands:", error);
        }
    }



}
