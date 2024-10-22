import { Client, Guild, GuildChannel, Message } from "discord.js";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function connectToDatabase() {
    try {
        await prisma.$connect();
        console.log("Connected to the database");
    } catch (err) {
        console.error("Error connecting to the database:", err);
        throw err;
    }
}

export async function nukeDatabase() {
    try {
        await prisma.message.deleteMany({});
        await prisma.channel.deleteMany({});
        await prisma.member.deleteMany({});
        await prisma.guild.deleteMany({});
        console.log("Database nuked successfully.");
    } catch (err) {
        console.error("Error nuking the database:", err);
        throw err;
    }
}

export async function getChannelByMessageId(messageId: string) {
    try {
        const message = await prisma.message.findUnique({
            where: { id: messageId },
            include: { channel: true },
        });
        if (message) {
            console.log(`Found channel: ${message.channel.name}`);
        } else {
            console.log(`Channel for message with ID ${messageId} not found.`);
        }
        return message?.channel;
    } catch (err) {
        console.error(
            `Error fetching channel for message ID ${messageId}:`,
            err,
        );
        throw err;
    }
}

function mapToMessage(data: any): any {
    return {
        id: data.id,
        channelId: data.channelId,
        authorId: data.authorId,
        content: data.content,
        timestamp: data.timestamp,
        editedTimestamp: data.editedTimestamp,
        tts: data.tts,
        mentionEveryone: data.mentionEveryone,
    };
}

export async function getMessagesBeforeMessageId(
    channelId: string,
    messageId: string,
    limit: number,
): Promise<Message[]> {
    try {
        const messages = await prisma.message.findMany({
            where: {
                channelId: channelId,
                id: {
                    lt: messageId,
                },
            },
            orderBy: {
                id: "desc",
            },
            take: limit,
        });
        return Promise.all(messages.map(mapToMessage));
    } catch (err) {
        console.error(
            `Error fetching messages before message ID ${messageId}:`,
            err,
        );
        throw err;
    }
}

export async function getMessagesAfterMessageId(
    channelId: string,
    messageId: string,
    limit: number,
): Promise<Message[]> {
    try {
        const messages = await prisma.message.findMany({
            where: {
                channelId: channelId,
                id: {
                    gt: messageId,
                },
            },
            orderBy: {
                id: "asc",
            },
            take: limit,
        });
        return Promise.all(messages.map(mapToMessage));
    } catch (err) {
        console.error(
            `Error fetching messages after message ID ${messageId}:`,
            err,
        );
        throw err;
    }
}

export async function getMessagesByAuthorId(
    authorId: string,
): Promise<Message[]> {
    try {
        const messages = await prisma.message.findMany({
            where: { authorId: authorId },
        });
        console.log(
            `Found ${messages.length} message(s) by author ID ${authorId}.`,
        );
        return await Promise.all(messages.map(mapToMessage));
    } catch (err) {
        console.error(`Error fetching messages by author ID ${authorId}:`, err);
        throw err;
    }
}

export async function getMessagesByMentionedUserId(
    userId: string,
): Promise<Message[]> {
    try {
        const messages = await prisma.message.findMany({
            where: {
                content: {
                    contains: `<@${userId}>`,
                },
            },
        });
        console.log(
            `Found ${messages.length} message(s) mentioning user ID ${userId}.`,
        );
        return await Promise.all(messages.map(mapToMessage));
    } catch (err) {
        console.error(
            `Error fetching messages mentioning user ID ${userId}:`,
            err,
        );
        throw err;
    }
}

export async function getGuildById(guildId: string) {
    try {
        const guild = await prisma.guild.findUnique({
            where: { id: guildId },
        });
        if (guild) {
            console.log(`Found guild: ${guild.name}`);
        } else {
            console.log(`Guild with ID ${guildId} not found.`);
        }
        return guild;
    } catch (err) {
        console.error(`Error fetching guild with ID ${guildId}:`, err);
        throw err;
    }
}

export async function getAllGuilds() {
    try {
        const guilds = await prisma.guild.findMany();
        console.log(`Found ${guilds.length} guild(s).`);
        return guilds;
    } catch (err) {
        console.error("Error fetching all guilds:", err);
        throw err;
    }
}

export async function getChannelById(channelId: string) {
    try {
        const channel = await prisma.channel.findUnique({
            where: { id: channelId },
        });
        if (channel) {
            console.log(`Found channel: ${channel.name}`);
        } else {
            console.log(`Channel with ID ${channelId} not found.`);
        }
        return channel;
    } catch (err) {
        console.error(`Error fetching channel with ID ${channelId}:`, err);
        throw err;
    }
}

export async function getChannelsByGuildId(guildId: string) {
    try {
        const channels = await prisma.channel.findMany({
            where: { guildId: guildId },
        });
        console.log(
            `Found ${channels.length} channel(s) for guild ID ${guildId}.`,
        );
        return channels;
    } catch (err) {
        console.error(`Error fetching channels for guild ID ${guildId}:`, err);
        throw err;
    }
}

export async function getMemberById(memberId: string) {
    try {
        const member = await prisma.member.findUnique({
            where: { id: memberId },
        });
        if (member) {
            console.log(`Found member: ${member.username}`);
        } else {
            console.log(`Member with ID ${memberId} not found.`);
        }
        return member;
    } catch (err) {
        console.error(`Error fetching member with ID ${memberId}:`, err);
        throw err;
    }
}

export async function getMembersByGuildId(guildId: string) {
    try {
        const members = await prisma.member.findMany({
            where: { guildId: guildId },
        });
        console.log(
            `Found ${members.length} member(s) for guild ID ${guildId}.`,
        );
        return members;
    } catch (err) {
        console.error(`Error fetching members for guild ID ${guildId}:`, err);
        throw err;
    }
}

export async function getMessageById(messageId: string) {
    try {
        const message = await prisma.message.findUnique({
            where: { id: messageId },
        });
        if (message) {
            console.log(`Found message: ${message.content}`);
        } else {
            console.log(`Message with ID ${messageId} not found.`);
        }
        return message;
    } catch (err) {
        console.error(`Error fetching message with ID ${messageId}:`, err);
        throw err;
    }
}

export async function getMessagesByChannelId(channelId: string) {
    try {
        const messages = await prisma.message.findMany({
            where: { channelId: channelId },
        });
        console.log(
            `Found ${messages.length} message(s) for channel ID ${channelId}.`,
        );
        return messages;
    } catch (err) {
        console.error(
            `Error fetching messages for channel ID ${channelId}:`,
            err,
        );
        throw err;
    }
}

export async function insertGuild(guild: Guild) {
    try {
        // Use upsert to either update or create the guild if it doesn't exist
        await prisma.guild.upsert({
            where: { id: guild.id },
            update: {
                name: guild.name,
                ownerId: guild.ownerId,
            },
            create: {
                id: guild.id,
                name: guild.name,
                ownerId: guild.ownerId,
            },
        });
        console.log(`Inserted or updated guild: ${guild.name}`);
    } catch (err) {
        console.error("Error inserting or updating guild:", err);
    }
}

export async function insertChannel(channel: GuildChannel, guildId: string) {
    try {
        const position = channel.position !== undefined ? channel.position : 0; // Provide a default value

        // Use upsert to ensure the channel is inserted if not found
        await prisma.channel.upsert({
            where: { id: channel.id },
            update: {
                name: channel.name,
                type: channel.type.toString(),
                position: position,
                guildId: guildId,
            },
            create: {
                id: channel.id,
                name: channel.name,
                type: channel.type.toString(),
                position: position,
                guildId: guildId,
            },
        });
        console.log(`Channel ${channel.name} inserted or updated.`);
    } catch (err) {
        console.error("Error inserting or updating channel:", err);
    }
}

export async function insertMember(author: any, guildId: string) {
    try {
        await prisma.member.upsert({
            where: { id: author.id },
            update: {},
            create: {
                id: author.id,
                guildId: guildId,
                username: author.username,
                discriminator: author.discriminator,
                nickname: author.nickname || null,
                joinedAt: new Date(),
            },
        });
        console.log(`Inserted or updated member: ${author.username}`);
    } catch (err) {
        if ((err as any).code === "P2003") {
            console.error(
                `Failed to insert member with ID ${author.id}: Foreign key violation`,
            );
        } else {
            console.error(`Error inserting member ${author.id}`, err);
        }
    }
}

export async function insertMessages(messages: Message[], guildId: string) {
    for (const message of messages) {
        let authorId = message.author?.id || null; // Set to null if no author

        try {
            if (authorId) {
                const memberExists = await prisma.member.findUnique({
                    where: { id: authorId },
                });

                if (!memberExists) {
                    // Attempt to insert the member
                    await insertMember(message.author, guildId);
                }
            }
        } catch (err) {
            console.error(
                `Failed to insert member with ID ${authorId}, setting authorId to null`,
                err,
            );
            // Set authorId to null if insertion fails
            authorId = null;
        }

        // Now insert the message with either the real authorId or null
        try {
            await prisma.message.upsert({
                where: { id: message.id },
                update: {},
                create: {
                    id: message.id,
                    content: message.content,
                    timestamp: new Date(message.createdTimestamp),
                    editedTimestamp: message.editedTimestamp
                        ? new Date(message.editedTimestamp)
                        : null,
                    tts: message.tts,
                    mentionEveryone: message.mentions.everyone,
                    channelId: message.channelId,
                    authorId: authorId, // This can now be null
                },
            });
        } catch (err) {
            console.error(`Failed to insert message: ${message.id}`, err);
        }
    }
}

export async function insertUnknownMember(guildId: string) {
    try {
        await prisma.member.upsert({
            where: { id: "unknown" },
            update: {},
            create: {
                id: "unknown",
                guildId: guildId,
                username: "Unknown",
                discriminator: "0000",
                nickname: null,
                joinedAt: new Date(),
            },
        });
        console.log(`Inserted or updated "unknown" member`);
    } catch (err) {
        console.error(`Error inserting "unknown" member`, err);
    }
}

export async function insertMembersFromMessages(
    messages: Message[],
    guildId: string,
    client: Client,
) {
    const uniqueAuthorIds = [
        ...new Set(messages.map((message) => message.author.id)),
    ];

    for (const authorId of uniqueAuthorIds) {
        let memberExists = await prisma.member.findUnique({
            where: { id: authorId },
        });

        if (!memberExists) {
            // Attempt to fetch member details from Discord
            const discordGuild = await client.guilds.fetch(guildId);
            const discordMember = await discordGuild.members.fetch(authorId)
                .catch((err) => {
                    console.error(
                        `Unable to fetch member with ID ${authorId}`,
                        err,
                    );
                });

            if (discordMember) {
                await insertMember(discordMember.user, guildId);
            } else {
                console.error(
                    `Failed to fetch or insert member with ID ${authorId}`,
                );
            }
        }
    }
}
