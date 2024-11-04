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
        console.log(`Syncing data for guild '${guild.name}'...`);
        await syncGuild(guild.id, guild, tx);
        console.log("Synced guild data.");
        await syncMembers(guild.id, guild, tx);
        console.log("Synced guild members.");
        await syncRoles(guild, tx);
        console.log("Synced guild roles.");

        const channel = channelId
            ? guild.channels.cache.get(channelId)
            : undefined;
        if (
            channel &&
            (channel.type === ChannelType.GuildText ||
                channel.type === ChannelType.GuildCategory)
        ) {
            console.log(`Syncing channel '${channel.name}'...`);
            await syncChannel(guild.id, channel, tx);

            await tx.commit(); // Commit transaction before syncing messages
            console.log("Transaction committed before syncing messages.");

            if (channel.type === ChannelType.GuildText) {
                await syncMessages(channel as TextChannel, driver);
            }
        } else {
            console.error(
                `Channel with ID '${channelId}' not found or is not a text/category channel.`,
            );
        }
        console.log("Synced channel data.");
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
    guild: Guild,
    tx: Transaction,
): Promise<void> {
    const roles = guild.roles.cache.map((role) => ({
        id: role.id,
        name: role.name,
        color: role.hexColor,
        permissions: role.permissions.bitfield.toString(),
    }));

    // Sync roles and associate them with the guild
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
        { roles, guildId: guild.id },
    );

    const members = await guild.members.fetch();

    // Associate roles with users
    for (const member of members.values()) {
        const userRoles = member.roles.cache.map((role) => role.id);
        await tx.run(
            `
            MATCH (u:User {id: $userId})
            UNWIND $roleIds AS roleId
            MATCH (r:Role {id: roleId})
            MERGE (r)-[:ASSIGNED_TO]->(u)
            `,
            {
                userId: member.id,
                roleIds: userRoles,
            },
        );
    }
}

async function syncChannel(
    guildId: string,
    channel: TextChannel | CategoryChannel,
    tx: Transaction,
): Promise<void> {
    // Merge the channel node with a 'type' property
    await tx.run(
        `
        MATCH (g:Guild {id: $guildId})
        MERGE (c:Channel {id: $id})
        ON CREATE SET c.name = $name,
                      c.type = $type
        MERGE (g)-[:HAS_CHANNEL]->(c)
        `,
        {
            id: channel.id,
            name: channel.name,
            type: channel.type === ChannelType.GuildCategory
                ? "category"
                : "text",
            guildId,
        },
    );

    // If the channel has a parent, create the hierarchy
    if (channel.parentId) {
        await tx.run(
            `
            MATCH (parent:Channel {id: $parentId})
            MATCH (child:Channel {id: $childId})
            MERGE (parent)-[:PARENT_OF]->(child)
            `,
            { parentId: channel.parentId, childId: channel.id },
        );
    }
}

async function syncMessages(
    channel: TextChannel,
    driver: neo4j.Driver,
): Promise<number> {
    const batchSize = 100;
    let lastMessageId: string | undefined;
    let previousMessageId: string | undefined;
    let totalMessagesInChannel = 0;
    const maxRetries = 3;

    console.log(`Starting to sync messages for channel '${channel.name}'...`);

    while (true) {
        const options = { limit: batchSize, before: lastMessageId };
        let retries = 0;
        while (retries < maxRetries) {
            try {
                const messages = await channel.messages.fetch(options);
                if (messages.size === 0) {
                    console.log(
                        `Total messages collected: ${totalMessagesInChannel}`,
                    );
                    return totalMessagesInChannel;
                }

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
                    mentions: message.mentions.users.map((user) => user.id),
                    referenceId: message.reference?.messageId || null,
                }));

                const session = driver.session();

                await session.writeTransaction(async (tx) => {
                    // Merge messages
                    await tx.run(
                        `
                        UNWIND $messages AS message
                        MERGE (m:Message {id: message.id})
                        ON CREATE SET m.content = message.content,
                                      m.createdAt = message.createdAt,
                                      m.attachments = message.attachments
                        `,
                        { messages: messageData },
                    );

                    // Create SENT_BY relationships
                    await tx.run(
                        `
                        UNWIND $messages AS message
                        MATCH (u:User {id: message.authorId})
                        MATCH (m:Message {id: message.id})
                        MERGE (u)-[:SENT_MESSAGE]->(m)
                        `,
                        { messages: messageData },
                    );

                    // Create IN_CHANNEL relationships
                    await tx.run(
                        `
                        UNWIND $messages AS message
                        MATCH (c:Channel {id: message.channelId})
                        MATCH (m:Message {id: message.id})
                        MERGE (m)-[:IN_CHANNEL]->(c)
                        `,
                        { messages: messageData },
                    );

                    // Handle mentions
                    await tx.run(
                        `
                        UNWIND $messages AS message
                        UNWIND message.mentions AS mentionId
                        MATCH (m:Message {id: message.id})
                        MATCH (u:User {id: mentionId})
                        MERGE (m)-[:MENTIONS]->(u)
                        `,
                        { messages: messageData },
                    );

                    // Handle replies
                    await tx.run(
                        `
                        UNWIND $messages AS message
                        WITH message
                        WHERE message.referenceId IS NOT NULL
                        MATCH (m:Message {id: message.id})
                        MATCH (ref:Message {id: message.referenceId})
                        MERGE (m)-[:REPLIES_TO]->(ref)
                        `,
                        { messages: messageData },
                    );

                    // Create user interaction relationships for mentions
                    await tx.run(
                        `
                        UNWIND $messages AS message
                        UNWIND message.mentions AS mentionId
                        MATCH (author:User {id: message.authorId})
                        MATCH (mentioned:User {id: mentionId})
                        MERGE (author)-[r:INTERACTED_WITH {type: 'mention'}]->(mentioned)
                        ON CREATE SET r.count = 1
                        ON MATCH SET r.count = r.count + 1
                        `,
                        { messages: messageData },
                    );

                    // For replies between users
                    await tx.run(
                        `
                        UNWIND $messages AS message
                        WITH message
                        WHERE message.referenceId IS NOT NULL
                        MATCH (replyingUser:User {id: message.authorId})
                        MATCH (ref:Message {id: message.referenceId})
                        MATCH (originalAuthor:User {id: ref.authorId})
                        MERGE (replyingUser)-[r:INTERACTED_WITH {type: 'reply'}]->(originalAuthor)
                        ON CREATE SET r.count = 1
                        ON MATCH SET r.count = r.count + 1
                        `,
                        { messages: messageData },
                    );

                    // Create NEXT_MESSAGE relationships
                    const messageArray = Array.from(messages.values());
                    for (let i = 0; i < messageArray.length - 1; i++) {
                        const currentMessage = messageArray[i];
                        const nextMessage = messageArray[i + 1];

                        await tx.run(
                            `
                            MATCH (m1:Message {id: $currentMessageId})
                            MATCH (m2:Message {id: $nextMessageId})
                            MERGE (m1)-[:NEXT_MESSAGE]->(m2)
                            `,
                            {
                                currentMessageId: currentMessage.id,
                                nextMessageId: nextMessage.id,
                            },
                        );
                    }

                    // Link the last message of the previous batch to the first message of this batch
                    if (previousMessageId && messageArray.length > 0) {
                        await tx.run(
                            `
                            MATCH (prev:Message {id: $previousMessageId})
                            MATCH (first:Message {id: $firstMessageId})
                            MERGE (prev)-[:NEXT_MESSAGE]->(first)
                            `,
                            {
                                previousMessageId,
                                firstMessageId: messageArray[0].id,
                            },
                        );
                    }
                });

                await session.close();

                totalMessagesInChannel += messages.size;
                lastMessageId = messages.last()?.id;
                previousMessageId = messages.first()?.id;
                console.log(
                    `Fetched ${messages.size} messages, total so far: ${totalMessagesInChannel}`,
                );
                break;
            } catch (error) {
                console.error(`Error fetching messages: ${error}`);
                retries += 1;
                if (retries >= maxRetries) {
                    console.error(
                        `Max retries reached for fetching messages in channel '${channel.name}'`,
                    );
                    throw error;
                }
                console.log(
                    `Retrying fetch messages... (${retries}/${maxRetries})`,
                );
            }
        }
    }
}
