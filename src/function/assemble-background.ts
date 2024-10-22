import { GuildMember } from "discord.js";
import Logger from "@ptkdev/logger";
import { assembleConversations } from "../utils/conversation-utils";
import { Conversation } from "../types";
import {
    getMessagesByAuthorId,
    getMessagesByMentionedUserId,
} from "../database/db";

const logger = new Logger();

export async function assembleBackground(
    user: GuildMember,
): Promise<Conversation[]> {
    logger.info(`Starting to assemble background for user: ${user.user.tag}`);

    // Fetch user messages from the database
    logger.info(`Fetching messages authored by user: ${user.user.tag}`);
    const userMessages = await getMessagesByAuthorId(user.id);
    logger.info(
        `Fetched ${userMessages.length} messages authored by user: ${user.user.tag}`,
    );

    // Fetch messages mentioning the user from the database
    logger.info(`Fetching messages mentioning user: ${user.user.tag}`);
    const userMentions = await getMessagesByMentionedUserId(user.id);
    logger.info(
        `Fetched ${userMentions.length} messages mentioning user: ${user.user.tag}`,
    );

    // Aggregate conversations
    logger.info(`Aggregating conversations for user: ${user.user.tag}`);
    const allMessages = [...userMessages, ...userMentions];
    const conversations = await assembleConversations(allMessages);
    logger.info(
        `Assembled ${conversations.length} conversations for user: ${user.user.tag}`,
    );

    return conversations;
}
