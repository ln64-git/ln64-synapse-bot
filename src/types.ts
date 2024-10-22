// src/types.ts
import { Message } from "discord.js";
import { D } from "ollama/dist/shared/ollama.51f6cea9";

export interface Conversation {
    messages: Message[];
    timestamp: number;
}
