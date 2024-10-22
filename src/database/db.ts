import { Client, Guild, GuildChannel, GuildMember, Message } from "discord.js";
import { Pool } from "pg";

const db = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export async function connectToDatabase() {
    try {
        await db.connect();
        console.log("Connected to the database");
    } catch (err) {
        console.error("Error connecting to the database:", err);
        throw err;
    }
}

export async function nukeDatabase() {
    try {
        await db.query('DELETE FROM "Message"');
        await db.query('DELETE FROM "Channel"');
        await db.query('DELETE FROM "Member"');
        await db.query('DELETE FROM "Guild"');
        console.log("Database nuked successfully.");
    } catch (err) {
        console.error("Error nuking the database:", err);
        throw err;
    }
}

export async function getChannelByMessageId(messageId: string) {
    try {
        const res = await db.query(
            'SELECT "Channel".* FROM "Message" JOIN "Channel" ON "Message"."channelId" = "Channel"."id" WHERE "Message"."id" = $1',
            [messageId],
        );
        if (res.rows.length > 0) {
            console.log(`Found channel: ${res.rows[0].name}`);
            return res.rows[0];
        } else {
            console.log(`Channel for message with ID ${messageId} not found.`);
            return null;
        }
    } catch (err) {
        console.error(
            `Error fetching channel for message ID ${messageId}:`,
            err,
        );
        throw err;
    }
}

export async function insertPlaceholderGuild(guildId: string) {
    try {
        await db.query(
            `INSERT INTO "Guild" ("id", "name", "ownerId") VALUES ($1, 'Unknown', 'unknown')
             ON CONFLICT ("id") DO NOTHING`,
            [guildId],
        );
        console.log(`Inserted placeholder guild with ID ${guildId}`);
    } catch (err) {
        console.error(
            `Error inserting placeholder guild with ID ${guildId}`,
            err,
        );
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
        const res = await db.query(
            'SELECT * FROM "Message" WHERE "channelId" = $1 AND "id" < $2 ORDER BY "id" DESC LIMIT $3',
            [channelId, messageId, limit],
        );
        return res.rows.map(mapToMessage);
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
        const res = await db.query(
            'SELECT * FROM "Message" WHERE "channelId" = $1 AND "id" > $2 ORDER BY "id" ASC LIMIT $3',
            [channelId, messageId, limit],
        );
        return res.rows.map(mapToMessage);
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
        const res = await db.query(
            'SELECT * FROM "Message" WHERE "authorId" = $1',
            [authorId],
        );
        console.log(
            `Found ${res.rows.length} message(s) by author ID ${authorId}.`,
        );
        return res.rows.map(mapToMessage);
    } catch (err) {
        console.error(`Error fetching messages by author ID ${authorId}:`, err);
        throw err;
    }
}

export async function getMessagesByMentionedUserId(
    userId: string,
): Promise<Message[]> {
    try {
        const res = await db.query(
            'SELECT * FROM "Message" WHERE "content" LIKE $1',
            [`%<@${userId}>%`],
        );
        console.log(
            `Found ${res.rows.length} message(s) mentioning user ID ${userId}.`,
        );
        return res.rows.map(mapToMessage);
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
        const res = await db.query(
            'SELECT * FROM "Guild" WHERE "id" = $1',
            [guildId],
        );
        if (res.rows.length > 0) {
            console.log(`Found guild: ${res.rows[0].name}`);
            return res.rows[0];
        } else {
            console.log(`Guild with ID ${guildId} not found.`);
            return null;
        }
    } catch (err) {
        console.error(`Error fetching guild with ID ${guildId}:`, err);
        throw err;
    }
}

export async function getAllGuilds() {
    try {
        const res = await db.query('SELECT * FROM "Guild"');
        console.log(`Found ${res.rows.length} guild(s).`);
        return res.rows;
    } catch (err) {
        console.error("Error fetching all guilds:", err);
        throw err;
    }
}

export async function getChannelById(channelId: string) {
    try {
        const res = await db.query(
            'SELECT * FROM "Channel" WHERE "id" = $1',
            [channelId],
        );
        if (res.rows.length > 0) {
            console.log(`Found channel: ${res.rows[0].name}`);
            return res.rows[0];
        } else {
            console.log(`Channel with ID ${channelId} not found.`);
            return null;
        }
    } catch (err) {
        console.error(`Error fetching channel with ID ${channelId}:`, err);
        throw err;
    }
}

export async function getChannelsByGuildId(guildId: string) {
    try {
        const res = await db.query(
            'SELECT * FROM "Channel" WHERE "guildId" = $1',
            [guildId],
        );
        console.log(
            `Found ${res.rows.length} channel(s) for guild ID ${guildId}.`,
        );
        return res.rows;
    } catch (err) {
        console.error(`Error fetching channels for guild ID ${guildId}:`, err);
        throw err;
    }
}

export async function getMemberById(memberId: string) {
    try {
        const res = await db.query(
            'SELECT * FROM "Member" WHERE "id" = $1',
            [memberId],
        );
        if (res.rows.length > 0) {
            console.log(`Found member: ${res.rows[0].username}`);
            return res.rows[0];
        } else {
            console.log(`Member with ID ${memberId} not found.`);
            return null;
        }
    } catch (err) {
        console.error(`Error fetching member with ID ${memberId}:`, err);
        throw err;
    }
}

export async function getMembersByGuildId(guildId: string) {
    try {
        const res = await db.query(
            'SELECT * FROM "Member" WHERE "guildId" = $1',
            [guildId],
        );
        console.log(
            `Found ${res.rows.length} member(s) for guild ID ${guildId}.`,
        );
        return res.rows;
    } catch (err) {
        console.error(`Error fetching members for guild ID ${guildId}:`, err);
        throw err;
    }
}

export async function getMessageById(messageId: string) {
    try {
        const res = await db.query(
            'SELECT * FROM "Message" WHERE "id" = $1',
            [messageId],
        );
        if (res.rows.length > 0) {
            console.log(`Found message: ${res.rows[0].content}`);
            return res.rows[0];
        } else {
            console.log(`Message with ID ${messageId} not found.`);
            return null;
        }
    } catch (err) {
        console.error(`Error fetching message with ID ${messageId}:`, err);
        throw err;
    }
}

export async function getMessagesByChannelId(channelId: string) {
    try {
        const res = await db.query(
            'SELECT * FROM "Message" WHERE "channelId" = $1',
            [channelId],
        );
        console.log(
            `Found ${res.rows.length} message(s) for channel ID ${channelId}.`,
        );
        return res.rows;
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
        await db.query(
            `INSERT INTO \"Guild\" (\"id\", \"name\", \"ownerId\") VALUES ($1, $2, $3)
             ON CONFLICT (\"id\") DO UPDATE SET \"name\" = EXCLUDED.\"name\", \"ownerId\" = EXCLUDED.\"ownerId\"`,
            [guild.id, guild.name, guild.ownerId],
        );
        console.log(`Inserted or updated guild: ${guild.name}`);
    } catch (err) {
        console.error("Error inserting or updating guild:", err);
    }
}

export async function insertChannel(channel: GuildChannel, guildId: string) {
    try {
        const position = channel.position !== undefined ? channel.position : 0; // Provide a default value

        await db.query(
            `INSERT INTO \"Channel\" (\"id\", \"name\", \"type\", \"position\", \"guildId\") VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (\"id\") DO UPDATE SET \"name\" = EXCLUDED.\"name\", \"type\" = EXCLUDED.\"type\", \"position\" = EXCLUDED.\"position\", \"guildId\" = EXCLUDED.\"guildId\"`,
            [
                channel.id,
                channel.name,
                channel.type.toString(),
                position,
                guildId,
            ],
        );
        console.log(`Channel ${channel.name} inserted or updated.`);
    } catch (err) {
        console.error("Error inserting or updating channel:", err);
    }
}

export async function insertMember(member: GuildMember, guildId: string) {
    try {
        // Ensure the guild exists before inserting the member
        const guildRes = await db.query(
            'SELECT 1 FROM "Guild" WHERE "id" = $1',
            [guildId],
        );
        if (guildRes.rows.length === 0) {
            console.error(`Guild with ID ${guildId} does not exist.`);
            return;
        }

        // If the nickname is undefined or null, handle it properly
        const nickname = member.displayName || null;

        await db.query(
            `INSERT INTO \"Member\" (\"id\", \"username\", \"discriminator\", \"nickname\", \"joinedAt\", \"guildId\") VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (\"id\") DO UPDATE SET \"username\" = EXCLUDED.\"username\", \"discriminator\" = EXCLUDED.\"discriminator\", \"nickname\" = EXCLUDED.\"nickname\", \"joinedAt\" = EXCLUDED.\"joinedAt\", \"guildId\" = EXCLUDED.\"guildId\"`,
            [
                member.id,
                member.user.username,
                member.user.discriminator,
                nickname, // Insert null if no nickname is provided
                new Date(),
                guildId,
            ],
        );
    } catch (err) {
        if ((err as any).code === "23503") { // Foreign key violation
            console.error(
                `Failed to insert member with ID ${member.id}: Foreign key violation`,
            );
        } else {
            console.error(`Error inserting member ${member.id}`, err);
        }
    }
}
export async function insertMessages(messages: Message[], guildId: string) {
    console.log(`Starting to insert messages for guild ID ${guildId}`);

    // Ensure the guild exists before inserting messages
    let guildRes = await db.query(
        'SELECT 1 FROM "Guild" WHERE "id" = $1',
        [guildId],
    );
    if (guildRes.rows.length === 0) {
        console.warn(
            `Guild with ID ${guildId} does not exist. Inserting placeholder guild.`,
        );
        await insertPlaceholderGuild(guildId);
        // Re-check if the guild now exists
        guildRes = await db.query(
            'SELECT 1 FROM "Guild" WHERE "id" = $1',
            [guildId],
        );
        if (guildRes.rows.length === 0) {
            console.error(
                `Failed to insert placeholder guild with ID ${guildId}.`,
            );
            return;
        }
    }

    for (const message of messages) {
        let authorId = message.author?.id || null; // Set to null if no author

        try {
            if (authorId) {
                const res = await db.query(
                    'SELECT 1 FROM "Member" WHERE "id" = $1',
                    [authorId],
                );

                if (res.rows.length === 0) {
                    // Attempt to insert the member
                    if (message.guild) {
                        const guildMember = await message.guild.members.fetch(
                            authorId,
                        );
                        await insertMember(guildMember, guildId);
                    } else {
                        console.error(
                            `Message guild is null for message ID ${message.id}`,
                        );
                    }
                }
            }
        } catch (err) {
            // console.error(
            // `Failed to insert member with ID ${authorId}, setting authorId to unknown`,
            // err,
            // );
            // Set authorId to "unknown" if insertion fails
            authorId = "unknown";
        }

        // Now insert the message with either the real authorId or "unknown"
        try {
            await db.query(
                `INSERT INTO "Message" ("id", "content", "timestamp", "editedTimestamp", "tts", "mentionEveryone", "channelId", "authorId") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT ("id") DO UPDATE SET "content" = EXCLUDED."content", "timestamp" = EXCLUDED."timestamp", "editedTimestamp" = EXCLUDED."editedTimestamp", "tts" = EXCLUDED."tts", "mentionEveryone" = EXCLUDED."mentionEveryone", "channelId" = EXCLUDED."channelId", "authorId" = EXCLUDED."authorId"`,
                [
                    message.id,
                    message.content,
                    new Date(message.createdTimestamp),
                    message.editedTimestamp
                        ? new Date(message.editedTimestamp)
                        : null,
                    message.tts,
                    message.mentions.everyone,
                    message.channelId,
                    authorId,
                ],
            );
        } catch (err) {
            console.error(`Failed to insert message: ${message.id}`, err);
        }
    }

    console.log(`Finished inserting messages for guild ID ${guildId}`);
}

export async function insertUnknownMember(guildId: string) {
    try {
        await db.query(
            `INSERT INTO \"Member\" (\"id\", \"username\", \"discriminator\", \"nickname\", \"joinedAt\", \"guildId\") VALUES ('unknown', 'Unknown', '0000', NULL, $1, $2)
             ON CONFLICT (\"id\") DO UPDATE SET \"username\" = EXCLUDED.\"username\", \"discriminator\" = EXCLUDED.\"discriminator\", \"nickname\" = EXCLUDED.\"nickname\", \"joinedAt\" = EXCLUDED.\"joinedAt\", \"guildId\" = EXCLUDED.\"guildId\"`,
            [new Date(), guildId],
        );
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
    // Ensure the guild exists before inserting members
    const guildRes = await db.query(
        'SELECT 1 FROM "Guild" WHERE "id" = $1',
        [guildId],
    );
    if (guildRes.rows.length === 0) {
        console.error(`Guild with ID ${guildId} does not exist.`);
        return;
    }

    const uniqueAuthorIds = [
        ...new Set(messages.map((message) => message.author.id)),
    ];

    for (const authorId of uniqueAuthorIds) {
        let res = await db.query(
            'SELECT 1 FROM "Member" WHERE "id" = $1',
            [authorId],
        );

        if (res.rows.length === 0) {
            // Attempt to fetch member details from Discord
            const discordGuild = await client.guilds.fetch(guildId);
            const discordMember = await discordGuild.members.fetch(authorId)
                .catch(async (err) => {
                    if (err.code === 10007) { // Unknown Member
                        console.error(
                            `Unknown member with ID ${authorId}, inserting as unknown`,
                        );
                        await insertUnknownMember(guildId);
                        // Set authorId to 'unknown' for messages with this authorId
                        await db.query(
                            'UPDATE "Message" SET "authorId" = $1 WHERE "authorId" = $2',
                            ["unknown", authorId],
                        );
                    } else {
                        console.error(
                            `Unable to fetch member with ID ${authorId}`,
                            err,
                        );
                    }
                });

            if (discordMember) {
                await insertMember(discordMember, guildId);
            } else {
                console.error(
                    `Failed to fetch or insert member with ID ${authorId}`,
                );
            }
        }
    }
}
