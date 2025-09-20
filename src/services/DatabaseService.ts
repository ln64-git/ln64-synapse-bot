import { Collection, Db } from "mongodb";
import { GuildMember, Message, User } from "discord.js";
import type { UserData, MessageData, UserRoleHistory, UserRanking, UserStats } from "../types/database.js";

export class DatabaseService {
  private usersCollection: Collection<UserData>;
  private messagesCollection: Collection<MessageData>;
  private roleHistoryCollection: Collection<UserRoleHistory>;

  constructor(private db: Db) {
    this.usersCollection = db.collection("users");
    this.messagesCollection = db.collection("messages");
    this.roleHistoryCollection = db.collection("userRoleHistory");
  }

  // User Management
  async createOrUpdateUser(member: GuildMember): Promise<UserData> {
    const now = new Date();
    const userData: UserData = {
      userId: member.id,
      username: member.user.username,
      discriminator: member.user.discriminator,
      avatar: member.user.avatarURL() || undefined,
      guildId: member.guild.id,
      roles: member.roles.cache.map(role => role.id),
      joinedAt: member.joinedAt || now,
      isActive: true,
      lastSeen: now,
      messageCount: 0,
      createdAt: now,
      updatedAt: now
    };

    const existingUser = await this.usersCollection.findOne({
      userId: member.id,
      guildId: member.guild.id
    });

    if (existingUser) {
      // Update existing user
      await this.usersCollection.updateOne(
        { _id: existingUser._id },
        {
          $set: {
            username: userData.username,
            discriminator: userData.discriminator,
            avatar: userData.avatar,
            roles: userData.roles,
            isActive: true,
            lastSeen: now,
            updatedAt: now
          }
        }
      );
      return { ...existingUser, ...userData };
    } else {
      // Create new user
      await this.usersCollection.insertOne(userData);
      return userData;
    }
  }

  async getUser(userId: string, guildId: string): Promise<UserData | null> {
    return await this.usersCollection.findOne({ userId, guildId });
  }

  async updateUserLastSeen(userId: string, guildId: string): Promise<void> {
    await this.usersCollection.updateOne(
      { userId, guildId },
      {
        $set: {
          lastSeen: new Date(),
          updatedAt: new Date()
        }
      }
    );
  }

  async markUserAsLeft(userId: string, guildId: string): Promise<void> {
    await this.usersCollection.updateOne(
      { userId, guildId },
      {
        $set: {
          isActive: false,
          leftAt: new Date(),
          updatedAt: new Date()
        }
      }
    );
  }

  async incrementMessageCount(userId: string, guildId: string): Promise<void> {
    await this.usersCollection.updateOne(
      { userId, guildId },
      {
        $inc: { messageCount: 1 },
        $set: {
          lastSeen: new Date(),
          updatedAt: new Date()
        }
      }
    );
  }

  // Message Management
  async createMessage(message: Message): Promise<MessageData> {
    const now = new Date();
    const messageData: MessageData = {
      messageId: message.id,
      userId: message.author.id,
      username: message.author.username,
      channelId: message.channel.id,
      channelName: message.channel.isTextBased() && 'name' in message.channel ? message.channel.name || 'Unknown' : 'Unknown',
      guildId: message.guild?.id || '',
      content: message.content,
      characterCount: message.content.length,
      timestamp: message.createdAt,
      isDeleted: false,
      isEdited: false,
      attachments: message.attachments.map(att => att.url),
      embeds: message.embeds.map(embed => embed.toJSON()),
      reactions: message.reactions.cache.map(reaction => ({
        emoji: reaction.emoji.name || reaction.emoji.toString(),
        count: reaction.count,
        users: []
      })),
      createdAt: now,
      updatedAt: now
    };

    await this.messagesCollection.insertOne(messageData);
    return messageData;
  }

  async updateMessage(message: Message): Promise<void> {
    const now = new Date();
    await this.messagesCollection.updateOne(
      { messageId: message.id },
      {
        $set: {
          content: message.content,
          characterCount: message.content.length,
          editedAt: now,
          isEdited: true,
          attachments: message.attachments.map(att => att.url),
          embeds: message.embeds.map(embed => embed.toJSON()),
          reactions: message.reactions.cache.map(reaction => ({
            emoji: reaction.emoji.name || reaction.emoji.toString(),
            count: reaction.count,
            users: []
          })),
          updatedAt: now
        }
      }
    );
  }

  async markMessageAsDeleted(messageId: string): Promise<void> {
    await this.messagesCollection.updateOne(
      { messageId },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          updatedAt: new Date()
        }
      }
    );
  }

  // Role Management
  async trackRoleChange(
    userId: string,
    guildId: string,
    roleId: string,
    roleName: string,
    action: 'added' | 'removed',
    reason?: string
  ): Promise<void> {
    const roleHistory: UserRoleHistory = {
      userId,
      guildId,
      roleId,
      roleName,
      action,
      timestamp: new Date(),
      reason
    };

    await this.roleHistoryCollection.insertOne(roleHistory);
  }

  async getUserRoles(userId: string, guildId: string): Promise<string[]> {
    const user = await this.getUser(userId, guildId);
    return user?.roles || [];
  }

  async getRoleHistory(userId: string, guildId: string): Promise<UserRoleHistory[]> {
    return await this.roleHistoryCollection
      .find({ userId, guildId })
      .sort({ timestamp: -1 })
      .toArray();
  }

  // VC Time Calculation
  async calculateVcTime(guildId: string, userId: string, startDate: Date, endDate: Date): Promise<number> {
    const startMs = startDate.getTime();
    const endMs = endDate.getTime();

    const voiceEvents = this.db.collection("voiceEvents");

    // Get the last event before the start date
    const lastBefore = await voiceEvents.findOne(
      { guildId, userId, timestampMs: { $lt: startMs } },
      { sort: { timestampMs: -1 } }
    );

    // Get all events during the period
    const events = await voiceEvents
      .find({
        guildId,
        userId,
        timestampMs: { $gte: startMs, $lt: endMs }
      })
      .sort({ timestampMs: 1 })
      .toArray();

    // Calculate total time in VC
    let totalMinutes = 0;
    let sessionStart: number | null = null;

    // If user was in VC before the start date, start counting from startMs
    if (lastBefore && lastBefore.type === "join") {
      sessionStart = startMs;
    }

    for (const event of events) {
      if (event.type === "join") {
        sessionStart = event.timestampMs;
      } else if (event.type === "leave" && sessionStart !== null) {
        totalMinutes += Math.round((event.timestampMs - sessionStart) / 60000);
        sessionStart = null;
      }
    }

    // If user is still in VC at the end of the period
    if (sessionStart !== null) {
      totalMinutes += Math.round((endMs - sessionStart) / 60000);
    }

    return totalMinutes;
  }

  // Message Character Count
  async calculateCharacterCount(guildId: string, userId: string, startDate: Date, endDate: Date): Promise<number> {
    const result = await this.messagesCollection.aggregate([
      {
        $match: {
          guildId,
          userId,
          timestamp: { $gte: startDate, $lt: endDate },
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          totalCharacters: { $sum: "$characterCount" }
        }
      }
    ]).toArray();

    return result[0]?.totalCharacters || 0;
  }

  // Message Count
  async calculateMessageCount(guildId: string, userId: string, startDate: Date, endDate: Date): Promise<number> {
    return await this.messagesCollection.countDocuments({
      guildId,
      userId,
      timestamp: { $gte: startDate, $lt: endDate },
      isDeleted: false
    });
  }

  // Ranking System
  async calculateUserRankings(guildId: string, days: number = 7): Promise<UserRanking[]> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - (days * 24 * 60 * 60 * 1000));

    // Get all users who have been active in the period
    const activeUsers = await this.usersCollection.find({
      guildId,
      isActive: true
    }).toArray();

    const rankings: UserRanking[] = [];

    for (const user of activeUsers) {
      const [vcMinutes, characterCount, messageCount] = await Promise.all([
        this.calculateVcTime(guildId, user.userId, startDate, endDate),
        this.calculateCharacterCount(guildId, user.userId, startDate, endDate),
        this.calculateMessageCount(guildId, user.userId, startDate, endDate)
      ]);

      // Calculate combined score (VC time + character count, weighted)
      const combinedScore = (vcMinutes * 0.3) + (characterCount * 0.7);

      rankings.push({
        userId: user.userId,
        username: user.username,
        vcMinutes,
        characterCount,
        messageCount,
        combinedScore,
        rank: 0 // Will be set after sorting
      });
    }

    // Sort by combined score (descending)
    rankings.sort((a, b) => b.combinedScore - a.combinedScore);

    // Assign ranks
    rankings.forEach((ranking, index) => {
      ranking.rank = index + 1;
    });

    return rankings;
  }

  // Get User Stats with Ranking
  async getUserStatsWithRanking(guildId: string, userId: string, days: number = 30): Promise<UserStats | null> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - (days * 24 * 60 * 60 * 1000));

    const user = await this.getUser(userId, guildId);
    if (!user) return null;

    const [vcMinutes, characterCount, messageCount] = await Promise.all([
      this.calculateVcTime(guildId, userId, startDate, endDate),
      this.calculateCharacterCount(guildId, userId, startDate, endDate),
      this.calculateMessageCount(guildId, userId, startDate, endDate)
    ]);

    // Get ranking for the last 7 days
    const rankings = await this.calculateUserRankings(guildId, 7);
    const userRanking = rankings.find(r => r.userId === userId);
    const rank = userRanking?.rank || rankings.length + 1;

    const totalUsers = await this.usersCollection.countDocuments({ guildId, isActive: true });

    return {
      userId,
      username: user.username,
      messageCount,
      characterCount,
      vcMinutes,
      vcHours: Math.round((vcMinutes / 60) * 100) / 100,
      rank,
      totalUsers
    };
  }

  // Utility Methods
  async getUserStats(guildId: string): Promise<{ totalUsers: number, activeUsers: number }> {
    const totalUsers = await this.usersCollection.countDocuments({ guildId });
    const activeUsers = await this.usersCollection.countDocuments({ guildId, isActive: true });

    return { totalUsers, activeUsers };
  }

  async getMessageStats(guildId: string): Promise<{ totalMessages: number, deletedMessages: number }> {
    const totalMessages = await this.messagesCollection.countDocuments({ guildId });
    const deletedMessages = await this.messagesCollection.countDocuments({ guildId, isDeleted: true });

    return { totalMessages, deletedMessages };
  }

  // Sync and Cleanup Methods
  async syncUserRoles(member: GuildMember): Promise<void> {
    await this.createOrUpdateUser(member);
  }

  async markInactiveUsers(guildId: string, days: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await this.usersCollection.updateMany(
      {
        guildId,
        lastSeen: { $lt: cutoffDate },
        isActive: true
      },
      {
        $set: {
          isActive: false,
          leftAt: new Date(),
          updatedAt: new Date()
        }
      }
    );

    return result.modifiedCount;
  }

  async removeUsersNotInServer(guildId: string, serverUserIds: string[]): Promise<number> {
    const result = await this.usersCollection.updateMany(
      {
        guildId,
        userId: { $nin: serverUserIds },
        isActive: true
      },
      {
        $set: {
          isActive: false,
          leftAt: new Date(),
          updatedAt: new Date()
        }
      }
    );

    return result.modifiedCount;
  }

  async getSyncStats(guildId: string): Promise<{
    totalUsers: number;
    activeUsers: number;
    inactiveUsers: number;
    totalMessages: number;
    deletedMessages: number;
    coverage: number;
  }> {
    const [userStats, messageStats] = await Promise.all([
      this.getUserStats(guildId),
      this.getMessageStats(guildId)
    ]);

    const inactiveUsers = await this.usersCollection.countDocuments({
      guildId,
      isActive: false
    });

    return {
      totalUsers: userStats.totalUsers,
      activeUsers: userStats.activeUsers,
      inactiveUsers,
      totalMessages: messageStats.totalMessages,
      deletedMessages: messageStats.deletedMessages,
      coverage: userStats.totalUsers > 0 ? Math.round((userStats.activeUsers / userStats.totalUsers) * 100) : 0
    };
  }

  // Message existence check
  async messageExists(messageId: string): Promise<boolean> {
    const message = await this.messagesCollection.findOne({ messageId });
    return message !== null;
  }

  // Verification methods
  async getChannelMessageCounts(guildId: string): Promise<{ [channelId: string]: number }> {
    const pipeline = [
      { $match: { guildId, isDeleted: false } },
      { $group: { _id: "$channelId", count: { $sum: 1 } } }
    ];

    const results = await this.messagesCollection.aggregate(pipeline).toArray();
    const channelCounts: { [channelId: string]: number } = {};

    for (const result of results) {
      channelCounts[result._id] = result.count;
    }

    return channelCounts;
  }

  async getOldestMessage(guildId: string): Promise<Date | null> {
    const oldest = await this.messagesCollection.findOne(
      { guildId, isDeleted: false },
      { sort: { timestamp: 1 } }
    );
    return oldest?.timestamp || null;
  }

  async getNewestMessage(guildId: string): Promise<Date | null> {
    const newest = await this.messagesCollection.findOne(
      { guildId, isDeleted: false },
      { sort: { timestamp: -1 } }
    );
    return newest?.timestamp || null;
  }

  async getMessageCountByUser(guildId: string): Promise<{ [userId: string]: number }> {
    const pipeline = [
      { $match: { guildId, isDeleted: false } },
      { $group: { _id: "$userId", count: { $sum: 1 } } }
    ];

    const results = await this.messagesCollection.aggregate(pipeline).toArray();
    const userCounts: { [userId: string]: number } = {};

    for (const result of results) {
      userCounts[result._id] = result.count;
    }

    return userCounts;
  }

  async getTotalCharacterCount(guildId: string): Promise<number> {
    const result = await this.messagesCollection.aggregate([
      { $match: { guildId, isDeleted: false } },
      { $group: { _id: null, totalChars: { $sum: "$characterCount" } } }
    ]).toArray();

    return result[0]?.totalChars || 0;
  }
}
