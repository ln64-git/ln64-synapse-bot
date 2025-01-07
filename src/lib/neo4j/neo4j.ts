import {
    CategoryChannel,
    Collection,
    Guild,
    GuildMember,
    Message,
    TextChannel,
} from "discord.js";
import { ChannelType, type Snowflake } from "discord-api-types/v10";
import neo4j, { Driver, Transaction } from "neo4j-driver";
import dotenv from "dotenv";
import process from "node:process";
import { ConversationManager } from "../../function/conversationManager";
import type { Conversation } from "../../types/types";

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
    // { logging: neo4j.logging.console("debug") },
);

export async function executeCypherQuery(
    cypherQuery: string,
): Promise<Record<string, unknown>[]> {
    const session = driver.session();
    try {
        console.log(`Executing Cypher Query: ${cypherQuery}`);
        const result = await session.run(cypherQuery);

        const records = result.records.map((record) => record.toObject());
        console.log(`Query returned ${records.length} record(s).`);
        return records;
    } catch (error) {
        console.error("Error executing Cypher query:", error);
        throw error;
    } finally {
        await session.close();
    }
}

export async function syncGuildData(guild: Guild) {
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
    } finally {
        await session.close();
    }
}

export async function syncChannelData(
    guild: Guild,
    channel: TextChannel | CategoryChannel,
) {
    const channelSession = driver.session();
    const channelTx = channelSession.beginTransaction();

    try {
        console.log(`Syncing channel '${channel.name}'...`);

        await syncChannel(guild.id, channel, channelTx);
        await channelTx.commit();
        console.log(`Synced channel '${channel.name}' data.`);

        if (channel.type === ChannelType.GuildText) {
            await syncMessages(channel as TextChannel);
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

export async function syncAllChannels(guild: Guild) {
    const channels = guild.channels.cache.filter(
        (channel: { type: ChannelType }) =>
            channel.type === ChannelType.GuildText ||
            channel.type === ChannelType.GuildCategory,
    );

    for (const channel of channels.values()) {
        await syncChannelData(guild, channel as TextChannel | CategoryChannel);
    }
}

export async function syncChannelToDatabase(guild: Guild, channelId: string) {
    const channel = guild.channels.cache.get(channelId) as
        | TextChannel
        | CategoryChannel;
    if (!channel) {
        console.error(`Channel with ID '${channelId}' not found.`);
        return;
    }

    const channelSession = driver.session();
    const channelTx = channelSession.beginTransaction();

    try {
        console.log(`Syncing channel '${channel.name}'...`);

        await syncChannel(guild.id, channel, channelTx);
        await channelTx.commit();
        console.log(`Synced channel '${channel.name}' data.`);

        if (channel.type === ChannelType.GuildText) {
            await syncMessages(channel as TextChannel);
        }
    } catch (error) {
        if ((error as { code?: number }).code === 50001) { // Missing Access
            console.warn(
                `Skipped channel '${channel.name}' due to Missing Access.`,
            );
        } else {
            console.error(`Error syncing channel '${channel.name}':`, error);
        }
        await channelTx.rollback();
    } finally {
        await channelSession.close();
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
    console.log("newGuildData: ", newGuildData);
    const result = await tx.run(
        `
        MATCH (g:Guild {id: $id})
        RETURN g {.*} AS g
        `,
        { id: guildId },
    );
    const existingGuild = result.records[0]?.get("g") || null;

    if (!existingGuild) {
        console.log(
            `Guild ${guild.name} does not exist in the database. Creating...`,
        );
    } else {
        console.log(`Guild ${guild.name} exists. Updating...`);
    }

    // Always run the MERGE statement
    await tx.run(
        `
        MERGE (g:Guild {id: $id})
        ON CREATE SET g.name = $name,
                      g.createdAt = $createdAt,
                      g.ownerId = $ownerId,
                      g.iconURL = $iconURL,
                      g.description = $description,
                      g.memberCount = $memberCount,
                      g.updatedAt = $updatedAt
        ON MATCH SET g.name = $name,
                     g.updatedAt = $updatedAt,
                     g.iconURL = $iconURL,
                     g.description = $description,
                     g.memberCount = $memberCount
        `,
        newGuildData,
    );
    console.log(`Guild ${guild.name} synchronized successfully.`);
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

export async function syncMessages(channel: TextChannel): Promise<number> {
    const conversationManager = new ConversationManager();
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
        let messagesCollection:
            | Collection<Snowflake, Message<true>>
            | undefined;

        while (retries < maxRetries) {
            try {
                // Fetch a batch of messages
                messagesCollection = await channel.messages.fetch(options);

                if (messagesCollection.size === 0) {
                    console.log(
                        `Total messages collected for channel '${channel.name}': ${totalMessagesInChannel}`,
                    );
                    break;
                }

                const messagesArray = [...messagesCollection.values()];
                for (const message of messagesArray.reverse()) {
                    // Add the individual message to the conversation manager
                    // await conversationManager.addMessageToConversations(
                    //     message,
                    // );

                    // Sync the user-to-message relationship
                    await syncUserToMessage(message);
                }

                // Save all conversations up to this point
                // const updatedConversations = conversationManager
                //     .getFormattedTopics();
                // for (const conversation of updatedConversations) {
                //     await saveConversationToDatabase(conversation);
                // }

                totalMessagesInChannel += messagesCollection.size;
                lastMessageId = messagesCollection.last()?.id;
                console.log(
                    `Fetched ${messagesCollection.size} messages, total so far: ${totalMessagesInChannel}`,
                );
                break; // Break retry loop on success
            } catch (error) {
                retries++;
                console.error(
                    `Error fetching messages in channel '${channel.name}', retrying (${retries}/${maxRetries}):`,
                    error,
                );
            }
        }

        if (
            retries >= maxRetries ||
            !lastMessageId ||
            (messagesCollection && messagesCollection.size === 0)
        ) {
            break; // Exit loop if max retries reached or no more messages
        }
    }

    return totalMessagesInChannel;
}

/**
 * Syncs the relationship between a user and a message in the database.
 */
async function syncUserToMessage(message: Message): Promise<void> {
    const session = driver.session();
    try {
        await session.run(
            `
            MERGE (u:User {id: $authorId})
            ON CREATE SET 
                u.username = $username,
                u.displayName = $displayName,
                u.avatarURL = $avatarURL
            MERGE (m:Message {id: $messageId})
            ON CREATE SET 
                m.content = $content, 
                m.createdAt = $createdAt
            MERGE (u)-[:HAS_MESSAGE]->(m)
            `,
            {
                authorId: message.author.id,
                username: message.author.username,
                displayName: message.member?.displayName ||
                    message.author.username,
                avatarURL: message.author.displayAvatarURL(),
                messageId: message.id,
                content: message.content,
                createdAt: message.createdAt.toISOString(),
            },
        );
        console.log(
            `Synced User ${message.author.id} with username "${message.author.username}" and displayName "${message.member?.displayName}" to Message ${message.id}`,
        );
    } catch (error) {
        console.error(
            `Error syncing User ${message.author.id} to Message ${message.id}:`,
            error,
        );
    } finally {
        await session.close();
    }
}

async function saveConversationToDatabase(conversation: Conversation) {
    const session = driver.session();
    try {
        // Structure your conversation data
        const conversationData = {
            id: conversation.id,
            participants: conversation.participants,
            startTime: conversation.startTime.toISOString(),
            lastActive: conversation.lastActive.toISOString(),
            messages: conversation.messages.map((msg, index, array) => ({
                id: msg.id,
                content: msg.content,
                createdAt: msg.createdAt.toISOString(),
                authorId: msg.author.id,
                displayName: msg.member?.displayName || msg.author.username,
                nextMessageId: array[index + 1]?.id || null, // Add next message ID
            })),
        };

        // Save conversation and messages with `SENT_MESSAGE` relationship
        await session.run(
            `
            MERGE (c:Conversation {id: $id})
            ON CREATE SET c.participants = $participants,
                          c.startTime = $startTime,
                          c.lastActive = $lastActive
            ON MATCH SET c.lastActive = $lastActive

            WITH c
            UNWIND $messages AS message
            MERGE (m:Message {id: message.id})
            ON CREATE SET m.content = message.content,
                          m.createdAt = message.createdAt,
                          m.authorId = message.authorId,
                          m.displayName = message.displayName
            MERGE (c)-[:HAS_MESSAGE]->(m)
            
            // Create the NEXT_MESSAGE relationship
            FOREACH (nextMessage IN CASE WHEN message.nextMessageId IS NOT NULL THEN [message.nextMessageId] ELSE [] END |
                MERGE (next:Message {id: nextMessage})
                MERGE (m)-[:NEXT_MESSAGE]->(next)
            )
            `,
            conversationData,
        );

        console.log(
            `Saved conversation ${conversation.id} with message order to the database.`,
        );
    } catch (error) {
        console.error(
            `Error saving conversation ${conversation.id} to the database:`,
            error,
        );
    } finally {
        await session.close();
    }
}

export async function getConversationsByUserId(
    userId: string,
) {
    const session = driver.session();
    try {
        const result = await session.run(
            `
            MATCH (u:User {id: $userId})-[:SENT_MESSAGE]->(m:Message)<-[:HAS_MESSAGE]-(c:Conversation)
            RETURN c { 
                id: c.id, 
                participants: c.participants, 
                startTime: c.startTime, 
                lastActive: c.lastActive, 
                messages: collect(m { 
                    id: m.id, 
                    content: m.content, 
                    createdAt: m.createdAt, 
                    authorId: m.authorId, 
                    displayName: m.displayName 
                }) 
            } AS conversation
            `,
            { userId },
        );

        // return result.records.map((record) => {
        //     const conversation = record.get("conversation");
        //     return {
        //         id: conversation.id,
        //         participants: conversation.participants,
        //         startTime: new Date(conversation.startTime),
        //         lastActive: new Date(conversation.lastActive),
        //         messages: conversation.messages.map((msg: any) => ({
        //             id: msg.id,
        //             content: msg.content,
        //             createdAt: new Date(msg.createdAt),
        //             author: { id: msg.authorId, username: msg.displayName },
        //             member: null, // Populate member if needed
        //         })),
        //     };
        // });
    } catch (error) {
        console.error(
            `Error fetching conversations for user ${userId}:`,
            error,
        );
        return [];
    } finally {
        await session.close();
    }
}
