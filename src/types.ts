import { Message } from "npm:discord.js";

export interface DiscordMessageWithEmbedding extends Message {
    messageData: Message[];
    cleanContentEmbedding?: number[];
}
