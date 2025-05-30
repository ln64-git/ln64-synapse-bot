import logger, { saveLog } from "./utils/logger";
import { Client, Collection, GatewayIntentBits, REST, Routes } from "discord.js";
import { Db, MongoClient } from "mongodb";
import { getMessages } from "./lib/discord/discord";
import { RelationshipNetwork } from "./feature/relationships/RelationshipNetwork";
import { speakVoiceCall } from "./function/speakVoiceCall";
import { setupHandlers } from "./utils/setupHandlers";
import { loadCommands } from "./utils/loadCommands";
import { ConversationManager } from "./feature/covnersations/ConversationManager";
import { trackActivity } from "./utils/trackActivity";
import { trackOnline } from "./utils/trackOnline";

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
                GatewayIntentBits.GuildPresences,
            ],
        });
    }

    async init() {
        await this.client.login(this.token);
        console.log(`Logged in as ${this.client.user?.tag}!`);

        this.setupEventHandlers();
        await this.connectToDatabase();
        await this.registerCommands();

        console.log("Bot is running!");

        // const arcados = await this.client.guilds.fetch("1254694808228986912");
        // const channelId = process.env.CHANNEL_ID || "";

        // const arcadosMessages = await getMessages(arcados, channelId);
        // const sortedMessages = arcadosMessages.sort((a, b) =>
        //     b.createdTimestamp - a.createdTimestamp
        // );

        // const message = sortedMessages[1];
        // const { keywords } = await this.conversationManager
        //     .getMessageKeywordsAndEmbedding(
        //         message,
        //     );
        // const messageJson = {
        //     content: message.cleanContent,
        //     username: message.author.username,
        //     keywords: keywords,
        // };

        // console.log(messageJson);
        // const arcados = await this.client.guilds.fetch("1254694808228986912");
        // const channelId = process.env.CHANNEL_ID || "";

        // const arcadosMessages = await getMessages(arcados, channelId);
        // if (arcadosMessages.length === 0) {
        //     console.warn("No messages fetched from the channel.");
        //     return;
        // }

        // console.log("Starting to process messages...");
        // await this.conversationManager.processMessages(arcadosMessages);
        // console.log("Finished processing messages.");
        // const threads = this.conversationManager.getSortedThreads();
        // console.log("Finished processing messages into threads...");

        // await saveLog(threads, "arcadosThreads");
        console.log("Finished processing messages into threads.");
    }
    private setupEventHandlers() {
        const user1Id = process.env.USER_1;

        if (!user1Id) {
            throw new Error(
                "One or both USER_1 and USER_2 environment variables are missing.",
            );
        }

        setupHandlers(this.client, this.commands, this.db);
        speakVoiceCall(this.client);
        logger(this.client);

        // trackActivity([user1Id, user2Id], this.client);
        // trackActivity([user2Id], this.client);
        trackOnline([user1Id], this.client);
        // trackOnline([user2Id], this.client);
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
