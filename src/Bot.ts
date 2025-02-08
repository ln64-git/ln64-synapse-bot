import { Client, Collection, GatewayIntentBits } from "discord.js";
import { Db, MongoClient } from "mongodb";
import { getArcadosMessages, getFiresideMessages } from "./lib/discord/discord";
import { RelationshipNetwork } from "./feature/relationships/RelationshipNetwork";
import { RelationshipManager } from "./feature/relationships/RelationshipManager";
import logger from "./utils/logger";
import { speakVoiceCall } from "./function/speakVoiceCall";
import type { UserProfile } from "./feature/relationships/UserProfile";

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
        await this.client.login(this.token);
        console.log(`Logged in as ${this.client.user?.tag}!`);

        this.setupEventHandlers();
        await this.connectToDatabase();
        await this.loadCommands();
        console.log("Bot is running!");

        const relationshipNetwork = new RelationshipNetwork(this.db);
        const relationshipManager = new RelationshipManager(
            relationshipNetwork,
        );

        const arcados = await this.client.guilds.fetch("1254694808228986912");
        const arcadosMessages = await getArcadosMessages(arcados);
        await relationshipManager.processMessages(arcadosMessages);

        const userProfile = relationshipNetwork.getUser(
            "940191264752664576",
        ) as UserProfile || (() => {
            console.log("User not found");
        });

        console.log(`${userProfile.guildMember.displayName} found.`);
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
