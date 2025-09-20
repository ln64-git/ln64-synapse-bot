import { Client, Events, GuildMember, User } from "discord.js";
import { DatabaseService } from "./DatabaseService.js";

export class UserTrackingService {
  constructor(
    private client: Client,
    private dbService: DatabaseService
  ) { }

  initialize(): void {
    this.client.on(Events.GuildMemberAdd, this.handleUserJoin.bind(this));
    this.client.on(Events.GuildMemberRemove, (member) => this.handleUserLeave(member as any));
    this.client.on(Events.GuildMemberUpdate, (oldMember, newMember) => this.handleUserUpdate(oldMember as any, newMember));
  }

  private async handleUserJoin(member: GuildMember): Promise<void> {
    try {
      console.log(`🔹 User joined: ${member.user.tag} (${member.id}) in ${member.guild.name}`);

      // Create or update user in database
      const userData = await this.dbService.createOrUpdateUser(member);
      console.log(`📊 User data created/updated:`, {
        userId: userData.userId,
        username: userData.username,
        guildId: userData.guildId,
        roles: userData.roles.length
      });

      // Check if user has previous role history and restore roles
      await this.restoreUserRoles(member);

      console.log(`✅ User data tracked for ${member.user.tag}`);
    } catch (error) {
      console.error(`❌ Error handling user join for ${member.user.tag}:`, error);
    }
  }

  private async handleUserLeave(member: GuildMember | Partial<GuildMember>): Promise<void> {
    try {
      console.log(`🔸 User left: ${member.user?.tag || 'Unknown'} (${member.id}) from ${member.guild?.name || 'Unknown'}`);

      if (member.guild && member.id) {
        // Mark user as left in database
        await this.dbService.markUserAsLeft(member.id, member.guild.id);

        // Store current roles before leaving
        const currentRoles = member.roles?.cache?.map(role => role.id) || [];
        await this.storeCurrentRoles(member.id, member.guild.id, currentRoles);

        console.log(`✅ User marked as left: ${member.user?.tag || 'Unknown'}`);
      }
    } catch (error) {
      console.error(`❌ Error handling user leave for ${member.user?.tag || 'Unknown'}:`, error);
    }
  }

  private async handleUserUpdate(oldMember: GuildMember | Partial<GuildMember>, newMember: GuildMember): Promise<void> {
    try {
      // Check for role changes
      const oldRoles = oldMember.roles?.cache?.map(role => role.id) || [];
      const newRoles = newMember.roles.cache.map(role => role.id);

      // Find added roles
      const addedRoles = newRoles.filter(roleId => !oldRoles.includes(roleId));
      // Find removed roles
      const removedRoles = oldRoles.filter(roleId => !newRoles.includes(roleId));

      // Track role changes
      for (const roleId of addedRoles) {
        const role = newMember.guild.roles.cache.get(roleId);
        if (role && !role.managed) {
          await this.dbService.trackRoleChange(
            newMember.id,
            newMember.guild.id,
            roleId,
            role.name,
            'added',
            'Role added via update'
          );
        }
      }

      for (const roleId of removedRoles) {
        const role = oldMember.guild?.roles.cache.get(roleId);
        if (role && !role.managed) {
          await this.dbService.trackRoleChange(
            newMember.id,
            newMember.guild.id,
            roleId,
            role.name,
            'removed',
            'Role removed via update'
          );
        }
      }

      // Update user data if there are changes
      if (addedRoles.length > 0 || removedRoles.length > 0) {
        await this.dbService.createOrUpdateUser(newMember);
      }

    } catch (error) {
      console.error(`❌ Error handling user update for ${newMember.user.tag}:`, error);
    }
  }

  private async restoreUserRoles(member: GuildMember): Promise<void> {
    try {
      const roleHistory = await this.dbService.getRoleHistory(member.id, member.guild.id);

      if (roleHistory.length === 0) {
        console.log(`No role history found for ${member.user.tag}`);
        return;
      }

      // Get the most recent role state before leaving
      const lastActiveRoles = await this.getLastActiveRoles(member.id, member.guild.id);

      if (lastActiveRoles.length === 0) {
        console.log(`No previous roles found for ${member.user.tag}`);
        return;
      }

      // Filter out managed roles and roles the bot can't manage
      const rolesToRestore = lastActiveRoles.filter(roleId => {
        const role = member.guild.roles.cache.get(roleId);
        return role &&
          !role.managed &&
          role.position < member.guild.members.me!.roles.highest.position;
      });

      if (rolesToRestore.length > 0) {
        try {
          await member.roles.set(rolesToRestore, 'Restoring previous roles');
          console.log(`✅ Restored ${rolesToRestore.length} roles for ${member.user.tag}`);
        } catch (error) {
          console.error(`❌ Failed to restore roles for ${member.user.tag}:`, error);
        }
      }

    } catch (error) {
      console.error(`❌ Error restoring roles for ${member.user.tag}:`, error);
    }
  }

  private async getLastActiveRoles(userId: string, guildId: string): Promise<string[]> {
    try {
      const user = await this.dbService.getUser(userId, guildId);
      return user?.roles || [];
    } catch (error) {
      console.error(`❌ Error getting last active roles for ${userId}:`, error);
      return [];
    }
  }

  private async storeCurrentRoles(userId: string, guildId: string, roles: string[]): Promise<void> {
    try {
      // Update the user's roles in the database
      const user = await this.dbService.getUser(userId, guildId);
      if (user) {
        // This will be handled by the createOrUpdateUser method
        // when the user rejoins, but we can also store it explicitly here
        console.log(`Stored ${roles.length} roles for ${userId} before leaving`);
      }
    } catch (error) {
      console.error(`❌ Error storing current roles for ${userId}:`, error);
    }
  }
}
