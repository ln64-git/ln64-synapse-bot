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

if (!neo4jUri || !neo4jUser || !neo4jPassword) {
    console.error("Error: Missing required environment variables.");
    process.exit(1);
}

const driver = neo4j.driver(
    neo4jUri,
    neo4j.auth.basic(neo4jUser, neo4jPassword),
);

export async function executeCypherQuery(
    cypherQuery: string,
): Promise<Record<string, unknown>[]> {
    const neo4jUri = Deno.env.get("NEO4J_URI");
    const neo4jUser = Deno.env.get("NEO4J_USERNAME");
    const neo4jPassword = Deno.env.get("NEO4J_PASSWORD");

    if (!neo4jUri || !neo4jUser || !neo4jPassword) {
        throw new Error("Missing Neo4j environment variables.");
    }

    const driver = neo4j.driver(
        neo4jUri,
        neo4j.auth.basic(neo4jUser, neo4jPassword),
    );
    const session = driver.session();

    try {
        const result = await session.run(cypherQuery);
        return result.records.map((record) => record.toObject());
    } finally {
        await session.close();
        await driver.close();
    }
}

export async function syncDatabase(guild: Guild) {
    const channelId = Deno.env.get("CHANNEL_ID");
    if (!channelId) {
        console.warn("CHANNEL_ID environment variable is not set.");
        return;
    }
    const channel = guild.channels.cache.get(channelId);

    if (
        channel &&
        (channel.type === ChannelType.GuildText ||
            channel.type === ChannelType.GuildCategory)
    ) {
        const channelSession = driver.session();
        const channelTx = channelSession.beginTransaction();

        try {
            if (channel.type === ChannelType.GuildText) {
                await syncMessages(channel as TextChannel, driver);
            }
        } catch (error) {
            if ((error as { code?: number }).code === 50001) { // Missing Access
                console.warn(
                    `Skipped channel '${channel.name}' due to Missing Access.`,
                );
            } else {
                console.error(
                    `Error syncing channel '${channel.name}':`,
                    error,
                );
            }
            await channelTx.rollback();
        } finally {
            await channelSession.close();
        }
    } else {
        console.warn(
            `Channel with ID '${channelId}' not found or unsupported type.`,
        );
    }
}

async function syncGuild(
    guildId: string,
    guild: Guild,
    tx: Transaction,
): Promise<void> {
    const newGuildData = {
        id: guildId,
        name: guild.name,
        createdAt: guild.createdAt.toISOString(),
        ownerId: guild.ownerId,
        iconURL: guild.iconURL() || null,
        description: guild.description || null,
        memberCount: guild.memberCount,
        updatedAt: new Date().toISOString(),
    };
    const result = await tx.run(
        `
        MATCH (g:Guild {id: $id})
        RETURN g
        `,
        { id: guildId },
    );
    const existingGuild = result.records[0]?.get("g") || null;

    if (existingGuild) {
        const existingProperties = existingGuild.properties;
        const hasChanges = Object.keys(newGuildData).some((key) => {
            const newValue = newGuildData[key as keyof typeof newGuildData];
            const existingValue =
                existingProperties[key as keyof typeof existingProperties];
            return newValue !== existingValue;
        });
        if (!hasChanges) {
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
                newGuildData,
            );
            console.log(`Guild ${guild.name} synchronized successfully.`);
        } else {
            console.log(
                `No changes detected for guild ${guild.name}. Skipping update.`,
            );
            return; // Exit if no changes detected
        }
    }
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
    const roles = guild.roles.cache.map((
        role: {
            id: string;
            name: string;
            hexColor: string;
            permissions: { bitfield: { toString: () => string } };
        },
    ) => ({
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
        const userRoles = member.roles.cache.map((role: { id: string }) =>
            role.id
        );
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
                        `Total messages collected for channel '${channel.name}': ${totalMessagesInChannel}`,
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
                        message.attachments.map((
                            attachment: { id: string; url: string },
                        ) => ({
                            id: attachment.id,
                            url: attachment.url,
                        })),
                    ),
                    mentions: message.mentions.users.map((
                        user: { id: string },
                    ) => user.id),
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
                break; // Break retry loop on success
            } catch (error) {
                if ((error as { code?: number }).code === 50001) { // Missing Access
                    console.warn(
                        `Missing Access for channel '${channel.name}'. Skipping message sync.`,
                    );
                    return totalMessagesInChannel; // Stop further syncing
                }

                console.error(`Error fetching messages: ${error}`);
                retries += 1;

                if (retries >= maxRetries) {
                    console.error(
                        `Max retries reached for fetching messages in channel '${channel.name}'`,
                    );
                    return totalMessagesInChannel; // Skip remaining messages
                }

                console.log(
                    `Retrying fetch messages... (${retries}/${maxRetries})`,
                );
            }
        }
    }
}
