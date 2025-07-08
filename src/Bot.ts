import logger from "./utils/logger";
import { Client, Collection, GatewayIntentBits, REST, Routes } from "discord.js";
import { Db, MongoClient } from "mongodb";
import { RelationshipNetwork } from "./insight/relationships/RelationshipNetwork";
import { speakVoiceCall } from "./handlers/speakVoiceCall";
import { initializeClientHandlers } from "./utils/setupHandlers";
import { loadCommands } from "./utils/loadCommands";
import { ConversationManager } from "./insight/covnersations/ConversationManager";
import { trackOnline } from "./utils/trackOnline";
import { addSpeechEvent } from "discord-speech-recognition";

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
        addSpeechEvent(this.client);  // ← This is essential
    }

    async init() {
        await this.client.login(this.token);
        console.log(`Logged in as ${this.client.user?.tag}!`);
        this.setupEventHandlers();
        await this.connectToDatabase();
        await this.registerCommands();
        console.log("Bot is running!");

        this.client.on("voiceStateUpdate", () => {
            console.log("voiceStateUpdate fired!!");
        });

    }

    private setupEventHandlers() {
        const user1Id = process.env.USER_2;

        if (!user1Id) {
            throw new Error(
                "One or both USER_1 and USER_2 environment variables are missing.",
            );
        }

        initializeClientHandlers(this.client, this.commands, this.db);
        speakVoiceCall(this.client);
        // listenVoiceCall(this.client);
        // stayBanned(this.client, this.db);
        logger(this.client);

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
