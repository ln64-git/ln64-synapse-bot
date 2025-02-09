import logger, { saveLog } from "./utils/logger";
import { Client, Collection, GatewayIntentBits } from "discord.js";
import { Db, MongoClient } from "mongodb";
import { getArcadosMessages } from "./lib/discord/discord";
import { RelationshipNetwork } from "./feature/relationships/RelationshipNetwork";
import { speakVoiceCall } from "./function/speakVoiceCall";
import { setupHandlers } from "./utils/setupHandlers";
import { loadCommands } from "./utils/loadCommands";
import { ConversationManager } from "./feature/covnersations/ConversationManager";

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
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildVoiceStates,
            ],
        });
    }

    async init() {
        await this.client.login(this.token);
        console.log(`Logged in as ${this.client.user?.tag}!`);

        this.setupEventHandlers();
        await this.connectToDatabase();
        // await this.loadCommands();

        console.log("Bot is running!");

        const arcados = await this.client.guilds.fetch("1254694808228986912");
        const arcadosMessages = await getArcadosMessages(arcados);

        await this.conversationManager.processMessages(arcadosMessages);

        const threads = this.conversationManager.getSortedThreads();

        await saveLog(threads, "arcadosThreads");

        console.log("Finished processing messages into threads.");
    }

    private setupEventHandlers() {
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
            this.relationshipNetwork = new RelationshipNetwork(this.db);
            this.conversationManager = new ConversationManager(); // Initialize ConversationManager
        } catch (error) {
            console.error("Failed to connect to MongoDB:", error);
            process.exit(1);
        }
    }

    private async loadCommands() {
        await loadCommands(this.client, this.commands);
    }
}
