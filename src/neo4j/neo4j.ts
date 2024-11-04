import {
    CategoryChannel,
    Guild,
    GuildMember,
    Message,
    TextChannel,
} from "npm:discord.js";
import { ChannelType } from "npm:discord-api-types/v10";
import neo4j, { Transaction } from "npm:neo4j-driver";
import dotenv from "npm:dotenv";
import process from "node:process";

dotenv.config();

const neo4jUri = Deno.env.get("NEO4J_URI");
const neo4jUser = Deno.env.get("NEO4J_USERNAME");
const neo4jPassword = Deno.env.get("NEO4J_PASSWORD");
const channelId = Deno.env.get("CHANNEL_ID");

if (!neo4jUri || !neo4jUser || !neo4jPassword) {
    console.error("Error: Missing required environment variables.");
    process.exit(1);
}

const driver = neo4j.driver(
    neo4jUri,
    neo4j.auth.basic(neo4jUser, neo4jPassword),
);

export async function syncDatabase(guild: Guild) {
    const session = driver.session();
    const tx = session.beginTransaction();

    try {
        await syncGuild(guild.id, guild, tx);
        await syncMembers(guild.id, guild, tx);
        await syncRoles(guild.id, guild, tx);

        const channel = channelId
            ? guild.channels.cache.get(channelId)
            : undefined;
        if (
            channel &&
            (channel.type === ChannelType.GuildText ||
                channel.type === ChannelType.GuildCategory)
        ) {
            await syncChannel(guild.id, channel, tx);

            if (channel.type === ChannelType.GuildText) {
                await syncMessages(channel as TextChannel, driver);
            }
        } else {
            console.error(
                `Channel with ID '${channelId}' not found or is not a text/category channel.`,
            );
        }

        await tx.commit();
    } catch (error) {
        console.error("Error syncing data to Neo4j:", error);
        await tx.rollback();
    } finally {
        await session.close();
    }
}

async function syncGuild(
    guildId: string,
    guild: Guild,
    tx: Transaction,
): Promise<void> {
    await tx.run(
        `
        MERGE (g:Guild {id: $id})
        ON CREATE SET g.name = $name,
                      g.createdAt = $createdAt,
                      g.ownerId = $ownerId,
                      g.iconURL = $iconURL,
                      g.description = $description,
                      g.memberCount = $memberCount
        ON MATCH SET g.name = COALESCE($name, g.name),
                     g.updatedAt = $updatedAt
        `,
        {
            id: guildId,
            name: guild.name,
            createdAt: guild.createdAt.toISOString(),
            ownerId: guild.ownerId,
            iconURL: guild.iconURL() || null,
            description: guild.description || null,
            memberCount: guild.memberCount,
            updatedAt: new Date().toISOString(),
        },
    );
}

async function syncMembers(
    guildId: string,
    guild: Guild,
    tx: Transaction,
): Promise<void> {
    const members = await guild.members.fetch();
    const memberData = members.map((member: GuildMember) => ({
        id: member.id,
        username: member.user.username,
        nickname: member.nickname || null,
        avatarURL: member.user.displayAvatarURL(),
        joinedAt: member.joinedAt?.toISOString() || null,
    }));

    await tx.run(
        `
        MATCH (g:Guild {id: $guildId})
        UNWIND $members AS member
        MERGE (u:User {id: member.id})
        ON CREATE SET u.username = member.username,
                      u.nickname = member.nickname,
                      u.avatarURL = member.avatarURL,
                      u.joinedAt = member.joinedAt
        MERGE (g)-[:HAS_MEMBER]->(u)
        `,
        { members: memberData, guildId },
    );
}

async function syncRoles(
    guildId: string,
    guild: Guild,
    tx: Transaction,
): Promise<void> {
    const roles = guild.roles.cache.map((role) => ({
        id: role.id,
        name: role.name,
        color: role.hexColor,
        permissions: role.permissions.bitfield.toString(),
    }));

    await tx.run(
        `
        MATCH (g:Guild {id: $guildId})
        UNWIND $roles AS role
        MERGE (r:Role {id: role.id})
        ON CREATE SET r.name = role.name,
                      r.color = role.color,
                      r.permissions = role.permissions
        MERGE (g)-[:HAS_ROLE]->(r)
        `,
        { roles, guildId },
    );
}

async function syncChannel(
    guildId: string,
    channel: TextChannel | CategoryChannel,
    tx: Transaction,
): Promise<void> {
    if (channel.type === ChannelType.GuildCategory) {
        await tx.run(
            `
            MATCH (g:Guild {id: $guildId})
            MERGE (cat:CategoryChannel {id: $id})
            ON CREATE SET cat.name = $name
            MERGE (g)-[:HAS_CATEGORY]->(cat)
            `,
            {
                id: channel.id,
                name: channel.name,
                guildId,
            },
        );
    } else if (channel.type === ChannelType.GuildText) {
        await tx.run(
            `
            MATCH (g:Guild {id: $guildId})
            MERGE (c:TextChannel {id: $id})
            ON CREATE SET c.name = $name
            MERGE (g)-[:HAS_CHANNEL]->(c)
            `,
            {
                id: channel.id,
                name: channel.name,
                guildId,
            },
        );

        if (channel.parentId) {
            await tx.run(
                `
                MATCH (cat:CategoryChannel {id: $parentId})
                MATCH (c:TextChannel {id: $channelId})
                MERGE (cat)-[:CONTAINS]->(c)
                `,
                { parentId: channel.parentId, channelId: channel.id },
            );
        }
    }
}

async function syncMessages(
    channel: TextChannel,
    driver: neo4j.Driver,
): Promise<number> {
    const batchSize = 100;
    let lastMessageId: string | undefined;
    let totalMessagesInChannel = 0;
    const maxRetries = 3;

    while (true) {
        const options = { limit: batchSize, before: lastMessageId };
        let retries = 0;

        while (retries < maxRetries) {
            try {
                const messages = await channel.messages.fetch(options);
                if (messages.size === 0) return totalMessagesInChannel;

                const messageData = messages.map((message: Message) => ({
                    id: message.id,
                    content: message.content,
                    authorId: message.author.id,
                    createdAt: message.createdAt.toISOString(),
                    channelId: message.channel.id,
                    attachments: JSON.stringify(
                        message.attachments.map((attachment) => ({
                            id: attachment.id,
                            url: attachment.url,
                        })),
                    ),
                }));

                const session = driver.session();
                const tx = session.beginTransaction();

                await tx.run(
                    `
                    UNWIND $messages AS message
                    MERGE (m:Message {id: message.id})
                    ON CREATE SET m.content = message.content,
                                  m.authorId = message.authorId,
                                  m.createdAt = message.createdAt
                    `,
                    { messages: messageData },
                );

                for (let i = 1; i < messageData.length; i++) {
                    await tx.run(
                        `
                        MATCH (m1:Message {id: $previousId}), (m2:Message {id: $currentId})
                        MERGE (m1)-[:NEXT_MESSAGE]->(m2)
                        `,
                        {
                            previousId: messageData[i - 1].id,
                            currentId: messageData[i].id,
                        },
                    );
                }

                await tx.commit();
                await session.close();

                totalMessagesInChannel += messages.size;
                lastMessageId = messages.last()?.id;
                break;
            } catch (error) {
                console.error(
                    `Error fetching messages for channel ${channel.id}:`,
                    error,
                );
                retries += 1;
                if (retries >= maxRetries) break;
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }

        if (!lastMessageId || retries === maxRetries) break;
    }

    return totalMessagesInChannel;
}
