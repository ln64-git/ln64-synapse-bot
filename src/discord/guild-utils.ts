import {
    Attachment,
    CategoryChannel,
    Collection,
    Embed,
    Guild,
    Message,
    TextChannel,
} from "npm:discord.js";
import { Session, Transaction } from "npm:neo4j-driver";
import { ChannelType, MessageType } from "npm:discord-api-types/v10";

// Function to sync Guild data
export async function syncGuild(guild: Guild, tx: Transaction): Promise<void> {
    try {
        console.log(
            `Starting synchronization for guild: ${guild.name} `,
        );
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
            {
                id: guild.id,
                name: guild.name,
                createdAt: guild.createdAt.toISOString(),
                ownerId: guild.ownerId,
                iconURL: guild.iconURL() || null,
                description: guild.description || null,
                memberCount: guild.memberCount,
                updatedAt: new Date().toISOString(),
            },
        );
        console.log(
            `Guild data for '${guild.name}' synchronized successfully.`,
        );
    } catch (error) {
        console.error(`Failed to sync guild data for '${guild.name}':`, error);
    }
}

// Function to sync Members and their Roles
export async function syncMembers(
    guild: Guild,
    tx: Transaction,
): Promise<void> {
    try {
        console.log(
            `Starting synchronization for members of guild: ${guild.name} (${guild.id})`,
        );
        const members = await guild.members.fetch();

        for (const member of members.values()) {
            console.log(
                `Synchronizing member: ${member.user.username} (${member.id})`,
            );
            await tx.run(
                `
          MERGE (u:User {id: $id})
          ON CREATE SET u.username = $username,
                        u.nickname = $nickname,
                        u.avatarURL = $avatarURL,
                        u.joinedAt = $joinedAt
          ON MATCH SET u.username = COALESCE($username, u.username),
                       u.nickname = COALESCE($nickname, u.nickname),
                       u.avatarURL = COALESCE($avatarURL, u.avatarURL),
                       u.joinedAt = COALESCE($joinedAt, u.joinedAt)
          MERGE (g:Guild {id: $guildId})-[:HAS_MEMBER]->(u)
        `,
                {
                    id: member.id,
                    username: member.user.username,
                    nickname: member.nickname || null,
                    avatarURL: member.user.displayAvatarURL(),
                    joinedAt: member.joinedAt?.toISOString() || null,
                    guildId: guild.id,
                },
            );

            const roleQueries = [];
            const roleParams = [];

            for (const role of member.roles.cache.values()) {
                console.log(
                    `Synchronizing role: ${role.name} (${role.id}) for user: ${member.user.username}`,
                );
                roleQueries.push(
                    `
            MERGE (r:Role {id: $roleId_${role.id}})
            ON CREATE SET r.name = $roleName_${role.id},
                          r.color = $roleColor_${role.id},
                          r.permissions = $permissions_${role.id},
                          r.createdAt = $roleCreatedAt_${role.id},
                          r.hoist = $hoist_${role.id},
                          r.position = $position_${role.id}
            ON MATCH SET r.name = COALESCE($roleName_${role.id}, r.name),
                         r.color = COALESCE($roleColor_${role.id}, r.color),
                         r.permissions = COALESCE($permissions_${role.id}, r.permissions),
                         r.hoist = COALESCE($hoist_${role.id}, r.hoist),
                         r.position = COALESCE($position_${role.id}, r.position)
            MERGE (u:User {id: $userId})-[:HAS_ROLE]->(r)
            MERGE (g:Guild {id: $guildId})-[:HAS_ROLE]->(r)
          `,
                );
                roleParams.push({
                    [`roleId_${role.id}`]: role.id,
                    [`roleName_${role.id}`]: role.name,
                    [`roleColor_${role.id}`]: role.hexColor,
                    [`permissions_${role.id}`]: role.permissions.bitfield
                        .toString(),
                    [`roleCreatedAt_${role.id}`]:
                        role.createdAt?.toISOString() || null,
                    [`hoist_${role.id}`]: role.hoist,
                    [`position_${role.id}`]: role.position,
                    userId: member.id,
                    guildId: guild.id,
                });
            }

            if (roleQueries.length > 0) {
                await tx.run(
                    roleQueries.join("\n"),
                    Object.assign({}, ...roleParams),
                );
            }
        }
        console.log(
            `Members and roles of guild '${guild.name}' synchronized successfully.`,
        );
    } catch (error) {
        console.error(
            `Failed to sync members and roles for guild '${guild.name}':`,
            error,
        );
    }
}

// Function to sync Channel data
// Function to sync Channel and Category data
export async function syncChannel(
    channel: TextChannel | CategoryChannel, // Include CategoryChannel type
    tx: Transaction,
): Promise<void> {
    // Check for null or undefined properties
    if (!channel.id || !channel.guild || !channel.guild.id) {
        console.warn(
            `Channel '${channel.name}' has missing or null 'id' or 'guild id' and cannot be synchronized.`,
        );
        return;
    }

    try {
        if (channel.type === ChannelType.GuildCategory) {
            // Sync category
            console.log(
                `Starting synchronization for category: ${channel.name} (${channel.id}) in guild: ${channel.guild.name} (${channel.guild.id})`,
            );
            await tx.run(
                `
                MERGE (cat:Category {id: $id})
                ON CREATE SET cat.name = $name,
                              cat.createdAt = $createdAt
                ON MATCH SET cat.name = COALESCE($name, cat.name)
                MERGE (g:Guild {id: $guildId})-[:HAS_CATEGORY]->(cat)
                `,
                {
                    id: channel.id,
                    name: channel.name,
                    createdAt: channel.createdAt.toISOString() || null,
                    guildId: channel.guild.id,
                },
            );
            console.log(
                `Category '${channel.name}' synchronized successfully.`,
            );
        } else if (channel.type === ChannelType.GuildText) {
            // Sync text channel and associate with category if it has a parent
            console.log(
                `Starting synchronization for channel: ${channel.name} (${channel.id}) in guild: ${channel.guild.name} (${channel.guild.id})`,
            );
            await tx.run(
                `
                MERGE (c:Channel {id: $id})
                ON CREATE SET c.name = $name,
                              c.type = $type,
                              c.topic = $topic,
                              c.nsfw = $nsfw,
                              c.parentId = $parentId
                ON MATCH SET c.name = COALESCE($name, c.name),
                             c.type = COALESCE($type, c.type),
                             c.topic = COALESCE($topic, c.topic),
                             c.nsfw = COALESCE($nsfw, c.nsfw),
                             c.parentId = COALESCE($parentId, c.parentId)
                MERGE (g:Guild {id: $guildId})-[:HAS_CHANNEL]->(c)
                ${
                    channel.parentId
                        ? "MERGE (cat:Category {id: $parentId})-[:CONTAINS]->(c)"
                        : ""
                }
              `,
                {
                    id: channel.id,
                    name: channel.name,
                    type: channel.type,
                    parentId: channel.parentId || null,
                    guildId: channel.guild.id,
                },
            );
            console.log(`Channel '${channel.name}' synchronized successfully.`);
        }
    } catch (error) {
        console.error(
            `Failed to sync channel or category '${channel.name}':`,
            error,
        );
    }
}

// Function to sync Messages within a Channel
export async function syncMessages(
    channel: TextChannel,
    session: Session,
): Promise<void> {
    console.log(
        `Starting synchronization for messages in channel: ${channel.name} (${channel.id})`,
    );
    const batchSize = 100; // Define a batch size for message sync
    let lastMessageId;

    try {
        while (true) {
            // Fetch messages in batches
            const messages: Collection<string, Message> = await channel.messages
                .fetch({
                    limit: batchSize,
                    before: lastMessageId,
                });

            if (messages.size === 0) break; // Exit if no more messages

            const tx = session.beginTransaction();
            try {
                for (const message of messages.values()) {
                    console.log(
                        `Synchronizing message: ${message.id} from user: ${message.author.username}`,
                    );

                    const attachments = message.attachments.map(
                        (attachment: Attachment) => ({
                            id: attachment.id,
                            url: attachment.url,
                            proxyURL: attachment.proxyURL,
                            contentType: attachment.contentType,
                            size: attachment.size,
                        }),
                    );

                    const embeds = message.embeds.map((embed: Embed) => ({
                        title: embed.title,
                        description: embed.description,
                        url: embed.url,
                        timestamp: embed.timestamp,
                        color: embed.color,
                        footer: embed.footer?.text,
                        image: embed.image?.url,
                        thumbnail: embed.thumbnail?.url,
                    }));

                    await tx.run(
                        `
                        MERGE (m:Message {id: $id})
                        ON CREATE SET m.content = $content,
                                      m.timestamp = $timestamp,
                                      m.attachments = $attachments,
                                      m.embeds = $embeds,
                                      m.isReply = $isReply,
                                      m.reactions = $reactions
                        MERGE (u:User {id: $userId})-[:SENT]->(m)
                        MERGE (c:Channel {id: $channelId})-[:CONTAINS_MESSAGE]->(m)
                        ${
                            message.reference?.messageId
                                ? "MERGE (m)-[:REPLY_TO]->(:Message {id: $replyTo})"
                                : ""
                        }
                      `,
                        {
                            id: message.id,
                            content: message.content || "",
                            timestamp: message.createdTimestamp,
                            userId: message.author.id,
                            channelId: channel.id,
                            attachments: JSON.stringify(attachments),
                            embeds: JSON.stringify(embeds),
                            isReply: message.type === MessageType.Reply,
                            replyTo: message.reference?.messageId || null,
                            reactions: JSON.stringify(
                                message.reactions.cache.map(
                                    (
                                        reaction: {
                                            emoji: { name: string };
                                            count: number;
                                        },
                                    ) => {
                                        if (
                                            reaction && reaction.emoji &&
                                            typeof reaction.count === "number"
                                        ) {
                                            return {
                                                emoji: reaction.emoji.name ||
                                                    "unknown",
                                                count: reaction.count,
                                            };
                                        } else {
                                            console.warn(
                                                `Skipping undefined or malformed reaction in message ${message.id}`,
                                            );
                                            return null; // Skip invalid reactions
                                        }
                                    },
                                ),
                            ),
                        },
                    );
                }
                await tx.commit(); // Commit each batch of messages
                console.log(
                    `Batch of messages in channel '${channel.name}' synchronized successfully.`,
                );
            } catch (messageError) {
                console.error(
                    `Failed to sync batch of messages in channel '${channel.name}':`,
                    messageError,
                );
                await tx.rollback();
            } finally {
                await tx.close();
            }

            // Update lastMessageId to continue with the next batch
            lastMessageId = messages.last()?.id;
        }
        console.log(
            `Messages in channel '${channel.name}' synchronized successfully.`,
        );
    } catch (channelError) {
        console.error(
            `Failed to sync messages in channel '${channel.name}':`,
            channelError,
        );
    }
}
