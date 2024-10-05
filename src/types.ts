// src/types.ts
import { Message } from "discord.js";

export interface Conversation {
    startTime: Date;
    endTime: Date;
    messages: Message[];
}