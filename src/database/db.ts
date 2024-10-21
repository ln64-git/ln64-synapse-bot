import { Channel, Guild, GuildChannel, GuildMember, Message } from "discord.js";

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

export async function getMessagesByAuthorId(authorId: string) {
    try {
        const messages = await prisma.message.findMany({
            where: { authorId: authorId },
        });
        console.log(
            `Found ${messages.length} message(s) from author ID ${authorId}.`,
        );
        return messages;
    } catch (err) {
        console.error(
            `Error fetching messages from author ID ${authorId}:`,
            err,
        );
        throw err;
    }
}

export async function insertGuild(guild: Guild) {
    try {
        await prisma.guild.upsert({
            where: { id: guild.id },
            update: {},
            create: {
                id: guild.id,
                name: guild.name,
                ownerId: guild.ownerId,
            },
        });
        console.log(`Inserted or updated guild: ${guild.name}`);
    } catch (err) {
        console.error("Error inserting guild:", err);
    }
}

export async function insertChannel(channel: GuildChannel, guildId: string) {
    try {
        const position = channel.position !== undefined ? channel.position : 0; // Provide a default value
        // Log the position to verify it's a valid integer
        console.log("Channel Position: ", channel.position);

        await prisma.channel.upsert({
            where: {
                id: channel.id, // Channel ID
            },
            update: {},
            create: {
                id: channel.id, // Channel ID
                guildId: guildId, // Guild ID
                name: channel.name, // Channel name
                type: channel.type.toString(), // Ensure type is string
                position: position,
            },
        });
        console.log(
            `Channel ${channel.name} inserted/updated in the database.`,
        );
    } catch (err) {
        console.error("Error inserting channel:", err);
    }
}

export async function insertMember(member: GuildMember) {
    try {
        await prisma.member.upsert({
            where: { id: member.id },
            update: {},
            create: {
                id: member.id,
                guildId: member.guild.id,
                username: member.user.username,
                discriminator: member.user.discriminator,
                nickname: member.nickname,
                joinedAt: member.joinedAt ?? new Date(), // Default to current date if `joinedAt` is null
            },
        });
        console.log(`Inserted or updated member: ${member.user.username}`);
    } catch (err) {
        console.error("Error inserting member:", err);
    }
}

export async function insertMessage(message: Message) {
    try {
        await prisma.message.upsert({
            where: { id: message.id },
            update: {},
            create: {
                id: message.id,
                channelId: message.channel.id,
                authorId: message.author.id,
                content: message.content,
                timestamp: new Date(message.createdTimestamp),
                editedTimestamp: message.editedTimestamp
                    ? new Date(message.editedTimestamp)
                    : null,
                tts: message.tts,
                mentionEveryone: message.mentions.everyone,
            },
        });
        console.log(`Inserted or updated message: ${message.id}`);
    } catch (err) {
        console.error("Error inserting message:", err);
    }
}

export async function insertMessages(messages: Message[]) {
    try {
        const messageData = messages.map((message) => ({
            id: message.id,
            channelId: message.channel.id,
            authorId: message.author.id,
            content: message.content,
            timestamp: new Date(message.createdTimestamp),
            editedTimestamp: message.editedTimestamp
                ? new Date(message.editedTimestamp)
                : null,
            tts: message.tts,
            mentionEveryone: message.mentions.everyone,
        }));

        // Batch insert messages using createMany
        await prisma.message.createMany({
            data: messageData,
            skipDuplicates: true, // Skip duplicates to avoid conflicts
        });

        console.log(`Inserted ${messages.length} messages successfully.`);
    } catch (err) {
        console.error("Error inserting messages:", err);
    }
}
