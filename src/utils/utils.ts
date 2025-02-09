import type { Message } from "discord.js";

/**
 * Converts a Discord message to a trimmed format, excluding sensitive or unnecessary data.
 * @param message - The Discord message to trim.
 * @returns A trimmed message object.
 */
export function convertToTrimmedMessage(message: Message<true>) {
    return {
        id: message.id,
        timestamp: message.createdTimestamp,
        server: message.guild?.name,
        channel: message.channel.name,
        message: {
            content: message.content,
            author: message.author.displayName,
            attachments: message.attachments.map((att) => att.url),
        },
    };
}
