import {
    ChannelType,
    Guild,
    GuildMember,
    Message,
    TextChannel,
} from "discord.js";
import Logger from "@ptkdev/logger";
import { assembleConversations } from "../utils/conversation-utils";
import { Conversation } from "../types";
import {
    fetchAllMessagesFromGuild,
    fetchMemberMentionsFromGuild,
    fetchMessagesFromGuildChannel,
} from "../discord/guild-utils";

const logger = new Logger();

export async function assembleBackground(
    guild: Guild,
    user: GuildMember,
    days?: number,
): Promise<Conversation[]> {
    const firesideChatChannel = guild.channels.cache.find((channel) =>
        channel.name === "fireside-chat" &&
        channel.type === ChannelType.GuildText
    ) as TextChannel | undefined;
    if (!firesideChatChannel) {
        return logger.error(
            "Fireside chat channel not found or is not a text channel.",
        ),
            [];
    }
    console.log(`Fetching messages from channel ID: ${firesideChatChannel.id}...`);

    const firesideChatMessages = await fetchMessagesFromGuildChannel(
        firesideChatChannel,
    );
    firesideChatMessages.forEach((message) => {
        console.log(`[${message.author.username}]: ${message.content}`);
    });
    logger.info(
        `Collected ${firesideChatMessages.length} messages from fireside-chat channel.`,
    );

    // const userConversations: Message[] = await fetchAllMessagesFromGuild(
    //     guild,
    //     days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined,
    // );
    // logger.info("Collecting User Mentions...");
    // const userMentions: Message[] = await fetchMemberMentionsFromGuild(
    //     guild,
    //     user.id,
    //     days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined,
    // );
    // logger.info(
    //     `Collected ${userMentions.length} messages mentioning the user.`,
    // );

    console.log("Aggregating Data...");

    // Aggregate conversations
    const allMessages = [...firesideChatMessages];
    // const allMessages = [...userConversations, ...userMentions];
    const conversations = await assembleConversations(allMessages);

    return conversations;
}
