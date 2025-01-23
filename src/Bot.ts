import { Client, Collection, GatewayIntentBits, TextChannel } from "discord.js";
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
        await this.connectToDatabase();
        await this.loadCommands();
        await this.client.login(this.token);
        this.setupEventHandlers();
        console.log("Bot is running!");

        const guilds = await this.client.guilds.fetch();
        for (const [guildId, partialGuild] of guilds) {
            try {
                const fullGuild = await partialGuild.fetch();

                const relationshipNetwork = new RelationshipNetwork(this.db);
                const relationshipManager = new RelationshipManager(
                    relationshipNetwork,
                );

                // Process initial messages in the channel
                if (guildId === "1004111007611895808") {
                    const firesideMessages = await getFiresideMessages(
                        this.client,
                    );
                    await relationshipManager.processMessages(firesideMessages);
                }
            } catch (error) {
                console.error(`Failed to process guild ${guildId}:`, error);
            }
        }
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
        const { loadCommands } = await import("./utils/loadCommands");
        await loadCommands(this.commands);
    }

    private async setupEventHandlers() {
        const { setupHandlers } = await import("./utils/setupHandlers");
        setupHandlers(this.client, this.commands, this.db);
        speakVoiceCall(this.client);
        logger(this.client);
    }
}
