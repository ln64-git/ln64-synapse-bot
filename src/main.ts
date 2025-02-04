import dotenv from "dotenv";
import { Bot } from "./Bot";

dotenv.config();

const botToken = process.env.BOT_TOKEN!;
const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017";

if (!botToken) {
  throw new Error("BOT_TOKEN is missing in the environment.");
}

const bot = new Bot(botToken, mongoUri);
bot.init().catch((err) => console.error("Failed to initialize bot:", err));
