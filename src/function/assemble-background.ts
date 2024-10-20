import { Guild, GuildMember, Message } from "discord.js";
import Logger from "@ptkdev/logger";
import { assembleConversations } from "../utils/conversation-utils";
import { Conversation } from "../types";
import {
    fetchAllMessagesFromUserChannels,
    fetchMemberMentionsFromGuild,
} from "../discord/guild-utils";

const logger = new Logger();

export async function assembleBackground(
    guild: Guild,
    user: GuildMember,
    days?: number,
): Promise<Conversation[]> {
    // Collect user conversations and mentions (arrays of messages)
    // const userConversations: Message[] = await fetchAllMessagesFromUserChannels(
    //     guild,
    //     user.id,
    //     days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined,
    // );
    // logger.info(`Collected ${userConversations.length} user messages.`);

    logger.info("Collecting User Mentions...");
    const userMentions: Message[] = await fetchMemberMentionsFromGuild(
        guild,
        user.id,
        days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined,
    );
    logger.info(
        `Collected ${userMentions.length} messages mentioning the user.`,
    );

    console.log("Aggregating Data...");

    // Aggregate conversations
    const allMessages = [...userMentions];
    // const allMessages = [...userConversations, ...userMentions];
    const conversations = await assembleConversations(allMessages);

    return conversations;
}
