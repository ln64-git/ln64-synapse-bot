import {
    CategoryChannel,
    Guild,
    GuildMember,
    Message,
    TextChannel,
} from "discord.js";
import { ChannelType } from "discord-api-types/v10";
import neo4j, { Driver, Transaction } from "neo4j-driver";
import dotenv from "dotenv";
import process from "node:process";
import { generateConversations } from "../../function/generateConversations";

dotenv.config();

const neo4jUri = process.env.NEO4J_URI;
const neo4jUser = process.env.NEO4J_USERNAME;
const neo4jPassword = process.env.NEO4J_PASSWORD;
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
    const session = driver.session();
    const tx = session.beginTransaction();
    console.log(`Syncing data for guild '${guild.name}'...`);
    try {
        await syncGuild(guild.id, guild, tx);
        console.log("Synced guild data.");
        await syncMembers(guild.id, guild, tx);
        console.log("Synced guild members.");
        await syncRoles(guild, tx);
        console.log("Synced guild roles.");
        await tx.commit();
        console.log(
            "Transaction committed for guild data before syncing channels and messages.",
        );
    } catch (error) {
        console.error("Error syncing data to Neo4j:", error);
        await tx.rollback();
        return;
    } finally {
        await session.close();
    }

    // Sync channels and messages separately in independent transactions
    const channels = guild.channels.cache.filter(
        (channel: { type: ChannelType }) =>
            channel.type === ChannelType.GuildText ||
            channel.type === ChannelType.GuildCategory,
    );

    for (const channel of channels.values()) {
        const channelSession = driver.session();
        const channelTx = channelSession.beginTransaction();

        try {
            console.log(`Syncing channel '${channel.name}'...`);

            await syncChannel(
                guild.id,
                channel as TextChannel | CategoryChannel,
                channelTx,
            );
            await channelTx.commit();
            console.log(`Synced channel '${channel.name}' data.`);

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
    driver: Driver,
): Promise<number> {
    console.log(`Entered syncMessages for channel: ${channel.name}`);

    if (!channel.messages) {
        console.error(`Channel '${channel.name}' does not have messages.`);
        return 0;
    }

    const batchSize = 100;
    let lastMessageId: string | undefined;
    let totalMessagesInChannel = 0;
    const maxRetries = 3;

    console.log(`Starting to sync messages for channel '${channel.name}'...`);

    while (true) {
        const options = { limit: batchSize, before: lastMessageId };
        let retries = 0;

        while (retries < maxRetries) {
            try {
                const messagesCollection = await channel.messages.fetch(
                    options,
                );
                // console.log("Fetched messagesCollection:", messagesCollection);
                // console.log(
                //     "messagesCollection.size:",
                //     messagesCollection.size,
                // );

                if (messagesCollection.size === 0) {
                    console.log(
                        `Total messages collected for channel '${channel.name}': ${totalMessagesInChannel}`,
                    );
                    return totalMessagesInChannel;
                }

                const messagesArray = [...messagesCollection.values()];
                // console.log(
                //     "messagesArray is array:",
                //     Array.isArray(messagesArray),
                // );
                // console.log("messagesArray length:", messagesArray.length);
                // console.log("First message in array:", messagesArray[0]);

                // Generate conversations
                const conversations = await generateConversations(
                    messagesArray,
                );
                if (messagesCollection.size === 0) {
                    console.log(
                        `Total messages collected for channel '${channel.name}': ${totalMessagesInChannel}`,
                    );
                    return totalMessagesInChannel;
                }

                const session = driver.session();

                await session.writeTransaction(async (tx: Transaction) => {
                    // Persist messages to Neo4j
                    const messageData = messagesArray.map((message) => ({
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

                    // Persist conversations
                    for (const conversation of conversations) {
                        const conversationId = conversation.id.toString();

                        // Create Conversation node
                        await tx.run(
                            `
                            MERGE (conv:Conversation {id: $id})
                            ON CREATE SET conv.startTime = $startTime,
                                          conv.lastActive = $lastActive,
                                          conv.participants = $participants
                            `,
                            {
                                id: conversationId,
                                startTime: conversation.startTime.toISOString(),
                                lastActive: conversation.lastActive
                                    .toISOString(),
                                participants: conversation.participants,
                            },
                        );

                        // Relate messages to conversations
                        for (const message of conversation.messages) {
                            await tx.run(
                                `
                                MATCH (m:Message {id: $messageId})
                                MATCH (conv:Conversation {id: $conversationId})
                                MERGE (m)-[:PART_OF]->(conv)
                                `,
                                {
                                    messageId: message.id,
                                    conversationId,
                                },
                            );
                        }

                        // Relate users to conversations
                        for (const participant of conversation.participants) {
                            await tx.run(
                                `
                                MATCH (u:User {username: $participant})
                                MATCH (conv:Conversation {id: $conversationId})
                                MERGE (u)-[:PARTICIPATED_IN]->(conv)
                                `,
                                {
                                    participant,
                                    conversationId,
                                },
                            );
                        }
                    }
                });

                await session.close();

                totalMessagesInChannel += messagesCollection.size;
                lastMessageId = messagesCollection.last()?.id;
                console.log(
                    `Fetched ${messagesCollection.size} messages, total so far: ${totalMessagesInChannel}`,
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
