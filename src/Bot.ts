import { Client, Collection, GatewayIntentBits } from "discord.js";
import { Db, MongoClient } from "mongodb";
import { getArcadosMessages, getFiresideMessages } from "./lib/discord/discord";
import { RelationshipNetwork } from "./feature/relationships/RelationshipNetwork";
import logger from "./utils/logger";
import { speakVoiceCall } from "./function/speakVoiceCall";
import type { UserProfile } from "./feature/relationships/UserProfile";
import { setupHandlers } from "./utils/setupHandlers";
import { loadCommands } from "./utils/loadCommands";
import { processMessages } from "./feature/relationships/utils";

export class Bot {
    public client: Client;
    public db!: Db;
    public commands = new Collection<string, any>();
    public relationshipNetwork = new RelationshipNetwork(this.db);

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

        const arcados = await this.client.guilds.fetch("1254694808228986912");
        const arcadosMessages = await getArcadosMessages(arcados);
        await processMessages(this.relationshipNetwork, arcadosMessages);

        const userProfile = this.relationshipNetwork.getUser(
            "940191264752664576",
        ) as UserProfile || (() => {
            console.log("User not found");
        });

        console.log(`${userProfile.guildMember.displayName} found.`);
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
        } catch (error) {
            console.error("Failed to connect to MongoDB:", error);
            process.exit(1);
        }
    }

    private async loadCommands() {
        await loadCommands(this.client, this.commands);
    }
}
