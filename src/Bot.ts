import { Client, Collection, GatewayIntentBits } from "discord.js";
import { Db, MongoClient } from "mongodb";
import { getFiresideMessages } from "./lib/discord/discord";
import { RelationshipNetwork } from "./feature/relationships/RelationshipNetwork";
import { RelationshipManager } from "./feature/relationships/RelationshipManager";
import logger from "./utils/logger";
import { speakVoiceCall } from "./function/speakVoiceCall";

export class Bot {
    public client: Client;
    public db!: Db;
    public commands = new Collection<string, any>();

    constructor(private token: string, private mongoUri: string) {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildVoiceStates,
            ],
        });
    }

    async init() {
        // 1) Log in first so we can fetch the guilds
        await this.client.login(this.token);
        console.log(`Logged in as ${this.client.user?.tag}!`);

        // 2) Set up event handlers
        this.setupEventHandlers();

        // 3) Connect to database
        await this.connectToDatabase();

        // 4) Load slash commands for ALL guilds
        await this.loadCommands();

        console.log("Bot is running!");

        // (Optional) Relationship logic
        const guilds = await this.client.guilds.fetch();
        const relationshipNetwork = new RelationshipNetwork(this.db);
        const relationshipManager = new RelationshipManager(
            relationshipNetwork,
        );

        for (const [guildId] of guilds) {
            try {
                if (guildId === "1004111007611895808") {
                    const firesideMessages = await getFiresideMessages(
                        this.client,
                    );
                    await relationshipManager.processMessages(firesideMessages);

                    const userProfile = relationshipNetwork.getUser(
                        "940191264752664576",
                    );
                    if (userProfile) {
                        console.log("User found");
                    } else {
                        console.log("User not found.");
                    }
                }
            } catch (error) {
                console.error(`Failed to process guild ${guildId}:`, error);
            }
        }
    }

    private setupEventHandlers() {
        const { setupHandlers } = require("./utils/setupHandlers");
        setupHandlers(this.client, this.commands, this.db);
        speakVoiceCall(this.client);
        logger(this.client);
    }

    private async connectToDatabase() {
        const mongoClient = new MongoClient(this.mongoUri);
        try {
            await mongoClient.connect();
            this.db = mongoClient.db("discordData");
            console.log("Connected to MongoDB.");
        } catch (error) {
            console.error("Failed to connect to MongoDB:", error);
            process.exit(1);
        }
    }

    private async loadCommands() {
        // Make sure your loadCommands function accepts (client, commandsCollection)
        const { loadCommands } = await import("./utils/loadCommands");
        await loadCommands(this.client, this.commands);
    }
}
