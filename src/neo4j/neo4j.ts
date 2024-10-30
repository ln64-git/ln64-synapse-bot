import {
    Attachment,
    CategoryChannel,
    Collection,
    Guild,
    GuildMember,
    Message,
    MessageType,
    Role,
    TextChannel,
} from "npm:discord.js";
import dotenv from "npm:dotenv";
dotenv.config();
import { Transaction } from "npm:neo4j-driver";
import { ChannelType } from "npm:discord-api-types/v10";
import neo4j from "npm:neo4j-driver";
import { config } from "https://deno.land/x/dotenv@v3.2.2/mod.ts";

config({ export: true });
const neo4jUri = Deno.env.get("NEO4J_URI");
const neo4jUser = Deno.env.get("NEO4J_USERNAME");
const neo4jPassword = Deno.env.get("NEO4J_PASSWORD");
if (!neo4jUri || !neo4jUser || !neo4jPassword) {
    console.error("Error: Missing required environment variables.");
    Deno.exit(1);
}
const driver = neo4j.driver(
    neo4jUri,
    neo4j.auth.basic(neo4jUser, neo4jPassword),
);
export async function syncDatabase(guild: Guild) {
    const trimmedGuildId = guild.id.split(":")[0];
    const session = driver.session();
    const tx = session.beginTransaction();

    try {
        await syncGuild(trimmedGuildId, guild, tx);
        console.log(`'${guild.name}' guild synchronized successfully.`);

        await syncMembers(trimmedGuildId, guild, tx);
        console.log(`'${guild.name}' members synchronized successfully.`);

        await syncRoles(trimmedGuildId, guild, tx);
        console.log(`'${guild.name}' roles synchronized successfully.`);

        const channels = guild.channels.cache.filter(
            (channel) =>
                channel.type === ChannelType.GuildText ||
                channel.type === ChannelType.GuildCategory,
        );

        for (const channel of channels.values()) {
            await syncChannel(trimmedGuildId, channel, tx);
            console.log(
                `'${guild.name}' channel '${channel.name}' synchronized successfully.`,
            );

            if (channel.type === ChannelType.GuildText) {
                await syncMessages(channel, tx);
                console.log(
                    `'${guild.name}' messages in channel '${channel.name}' synchronized successfully.`,
                );
            }
        }

        await tx.commit();
    } catch (error) {
        console.error("Error syncing data to Neo4j:", error);
        await tx.rollback();
    } finally {
        await session.close();
    }
}

// Function to sync Guild data
async function syncGuild(
    guildId: string,
    guild: Guild,
    tx: Transaction,
): Promise<void> {
    const params = {
        id: guildId,
        name: guild.name,
        createdAt: guild.createdAt.toISOString(),
        ownerId: guild.ownerId,
        iconURL: guild.iconURL() || null,
        description: guild.description || null,
        memberCount: guild.memberCount,
        updatedAt: new Date().toISOString(),
    };

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
                     g.updatedAt = $updatedAt,
                     g.iconURL = COALESCE($iconURL, g.iconURL),
                     g.description = COALESCE($description, g.description),
                     g.memberCount = COALESCE($memberCount, g.memberCount)
        `,
        params,
    );
}

// Function to sync Members
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
        guildId,
    }));

    await tx.run(
        `
        // Ensure the Guild node is matched and not re-created
        MATCH (g:Guild {id: $guildId})
        UNWIND $members AS member
        MERGE (u:User {id: member.id})
        ON CREATE SET u.username = member.username,
                      u.nickname = member.nickname,
                      u.avatarURL = member.avatarURL,
                      u.joinedAt = member.joinedAt
        ON MATCH SET u.username = COALESCE(member.username, u.username),
                     u.nickname = COALESCE(member.nickname, u.nickname),
                     u.avatarURL = COALESCE(member.avatarURL, u.avatarURL),
                     u.joinedAt = COALESCE(member.joinedAt, u.joinedAt)
        MERGE (g)-[:HAS_MEMBER]->(u)
        `,
        { members: memberData, guildId },
    );
}

// Function to sync Roles and associate them with Members
async function syncRoles(
    guildId: string,
    guild: Guild,
    tx: Transaction,
): Promise<void> {
    const roles = guild.roles.cache;
    const roleData = roles.map((role: Role) => ({
        roleId: role.id,
        roleName: role.name,
        roleColor: role.hexColor,
        permissions: role.permissions.bitfield.toString(),
        roleCreatedAt: role.createdAt?.toISOString() || null,
        hoist: role.hoist,
        position: role.position,
    }));

    // Insert or update roles, and associate them with the existing Guild
    await tx.run(
        `
        MATCH (g:Guild {id: $guildId})
        UNWIND $roles AS role
        MERGE (r:Role {id: role.roleId})
        ON CREATE SET r.name = role.roleName,
                      r.color = role.roleColor,
                      r.permissions = role.permissions,
                      r.createdAt = role.roleCreatedAt,
                      r.hoist = role.hoist,
                      r.position = role.position
        ON MATCH SET r.name = COALESCE(role.roleName, r.name),
                     r.color = COALESCE(role.roleColor, r.color),
                     r.permissions = COALESCE(role.permissions, r.permissions),
                     r.hoist = COALESCE(role.hoist, r.hoist),
                     r.position = COALESCE(role.position, r.position)
        MERGE (g)-[:HAS_ROLE]->(r)
        `,
        { roles: roleData, guildId },
    );

    // Associate roles with members
    const roleAssociations: { userId: string; roleId: string }[] = [];
    const members = await guild.members.fetch();
    members.forEach((member: GuildMember) => {
        member.roles.cache.forEach((role: Role) => {
            if (role.id !== guild.id) {
                roleAssociations.push({ userId: member.id, roleId: role.id });
            }
        });
    });

    // Create associations in one batch
    await tx.run(
        `
        UNWIND $associations AS assoc
        MATCH (u:User {id: assoc.userId})
        MATCH (r:Role {id: assoc.roleId})
        MERGE (u)-[:HAS_ROLE]->(r)
        `,
        { associations: roleAssociations },
    );
}

// Function to sync Channel and Category data
async function syncChannel(
    guildId: string,
    channel: TextChannel | CategoryChannel,
    tx: Transaction,
): Promise<void> {
    if (channel.type === ChannelType.GuildCategory) {
        // Sync category with additional properties and link it to the guild
        await tx.run(
            `
            MATCH (g:Guild {id: $guildId})
            MERGE (cat:CategoryChannel {id: $id})
            ON CREATE SET cat.name = $name,
                          cat.createdAt = $createdAt,
                          cat.position = $position,
                          cat.permissionsLocked = $permissionsLocked
            ON MATCH SET cat.name = COALESCE($name, cat.name),
                         cat.position = COALESCE($position, cat.position),
                         cat.permissionsLocked = COALESCE($permissionsLocked, cat.permissionsLocked)
            MERGE (g)-[:HAS_CATEGORY]->(cat)
            `,
            {
                id: channel.id,
                name: channel.name,
                createdAt: channel.createdAt.toISOString() || null,
                position: channel.position,
                permissionsLocked: channel.permissionsLocked || false,
                guildId,
            },
        );
    } else if (channel.type === ChannelType.GuildText) {
        // Sync text channel and associate it with guild and category if applicable
        await tx.run(
            `
            MATCH (g:Guild {id: $guildId})
            MERGE (c:TextChannel {id: $id})
            ON CREATE SET c.name = $name,
                          c.type = $type,
                          c.topic = $topic,
                          c.nsfw = $nsfw,
                          c.position = $position,
                          c.rateLimitPerUser = $rateLimitPerUser
            ON MATCH SET c.name = COALESCE($name, c.name),
                         c.type = COALESCE($type, c.type),
                         c.topic = COALESCE($topic, c.topic),
                         c.nsfw = COALESCE($nsfw, c.nsfw),
                         c.position = COALESCE($position, c.position),
                         c.rateLimitPerUser = COALESCE($rateLimitPerUser, c.rateLimitPerUser)
            MERGE (g)-[:HAS_CHANNEL]->(c)
            `,
            {
                id: channel.id,
                name: channel.name,
                type: channel.type,
                topic: channel.topic || null,
                nsfw: channel.nsfw,
                position: channel.position,
                rateLimitPerUser: channel.rateLimitPerUser || 0,
                guildId,
            },
        );

        // Link to parent category if exists
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

// Function to sync Messages in a Text Channel with a dynamic loading bar

// Function to sync Messages in a Text Channel with a dynamic loading bar
async function syncMessages(
    channel: TextChannel,
    tx: Transaction,
): Promise<void> {
    try {
        let fetchedCount = 0;
        let lastMessageId: string | undefined;

        // Fetch until there are no more messages left
        while (true) {
            // Type messages as Collection<string, Message>
            const messages: Collection<string, Message> = await channel.messages
                .fetch({
                    limit: 100,
                    ...(lastMessageId ? { before: lastMessageId } : {}),
                });

            const messageData = messages.map((message) => ({
                id: message.id,
                content: message.content,
                authorId: message.author.id,
                createdAt: message.createdAt.toISOString(),
                channelId: channel.id,
                attachments: JSON.stringify(
                    message.attachments.map((attachment: Attachment) => ({
                        id: attachment.id,
                        size: attachment.size,
                        contentType: attachment.contentType,
                        proxyURL: attachment.proxyURL,
                        url: attachment.url,
                    })),
                ),
                isReply: message.type === MessageType.Reply,
                replyTo: message.reference?.messageId || null,
            }));

            await tx.run(
                `
                UNWIND $messages AS msg
                MERGE (m:Message {id: msg.id})
                ON CREATE SET m.content = msg.content,
                              m.createdAt = msg.createdAt,
                              m.attachments = msg.attachments
                ON MATCH SET m.content = COALESCE(msg.content, m.content),
                             m.attachments = COALESCE(msg.attachments, m.attachments)

                // Link message to its author
                MERGE (u:User {id: msg.authorId})
                MERGE (u)-[:SENT]->(m)

                // Link message to its channel
                MERGE (c:TextChannel {id: msg.channelId})
                MERGE (c)-[:HAS_MESSAGE]->(m)

                // Optionally, link reply message to the original message if it's a reply
                FOREACH (ignoreMe IN CASE WHEN msg.replyTo IS NOT NULL THEN [1] ELSE [] END |
                    MERGE (replyMsg:Message {id: msg.replyTo})
                    MERGE (m)-[:REPLY_TO]->(replyMsg)
                )
                `,
                { messages: messageData },
            );

            fetchedCount += messages.size;

            // Estimate total progress based on completed rounds
            console.log(
                `Fetching messages for '${channel.name}': ${fetchedCount}`,
            );

            // Break the loop if no more messages are left to fetch
            if (messages.size < 100) break;
        }
    } catch (error) {
        if ((error as { code: number }).code === 50001) {
            console.warn(
                `Missing access to messages in channel '${channel.name}'. Skipping...`,
            );
        } else {
            console.error(
                `Failed to sync messages for channel '${channel.name}':`,
                error,
            );
        }
    }
}
