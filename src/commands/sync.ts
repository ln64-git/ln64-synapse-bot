import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { DatabaseService } from "../services/DatabaseService.js";

export const data = new SlashCommandBuilder()
  .setName("sync")
  .setDescription("Synchronize database with current server state")
  .addSubcommand(subcommand =>
    subcommand
      .setName("users")
      .setDescription("Sync all users in the server")
      .addBooleanOption(option =>
        option
          .setName("force")
          .setDescription("Force update existing users")
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName("roles")
      .setDescription("Sync user roles with current server state")
      .addUserOption(option =>
        option
          .setName("user")
          .setDescription("Specific user to sync roles for")
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName("cleanup")
      .setDescription("Clean up inactive users and orphaned data")
      .addNumberOption(option =>
        option
          .setName("days")
          .setDescription("Mark users inactive after this many days")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(365)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName("stats")
      .setDescription("Show database synchronization statistics")
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName("messages")
      .setDescription("Sync historical messages from all channels")
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName("verify")
      .setDescription("Verify sync completeness and data integrity")
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName("full")
      .setDescription("Perform full database synchronization")
      .addBooleanOption(option =>
        option
          .setName("confirm")
          .setDescription("Confirm you want to perform full sync")
          .setRequired(true)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction, context: { db: any, client: any, databaseService: DatabaseService }) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: "This command only works in servers.", ephemeral: true });
  }

  const dbService = context.databaseService;
  if (!dbService) {
    return interaction.reply({ content: "❌ Database service not available.", ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();

  try {
    switch (subcommand) {
      case "users":
        await handleSyncUsers(interaction, dbService);
        break;
      case "roles":
        await handleSyncRoles(interaction, dbService);
        break;
      case "cleanup":
        await handleCleanup(interaction, dbService);
        break;
      case "stats":
        await handleSyncStats(interaction, dbService);
        break;
      case "messages":
        await handleSyncMessages(interaction, dbService);
        break;
      case "verify":
        await handleVerifySync(interaction, dbService);
        break;
      case "full":
        await handleFullSync(interaction, dbService);
        break;
    }
  } catch (error) {
    console.error("Error in sync command:", error);
    await interaction.reply({ content: "❌ An error occurred during synchronization.", ephemeral: true });
  }
}

async function handleSyncUsers(interaction: ChatInputCommandInteraction, dbService: DatabaseService) {
  const force = interaction.options.getBoolean("force") || false;
  const guild = interaction.guild!;

  await interaction.deferReply({ ephemeral: true });

  try {
    const members = guild.members.cache.filter(member => !member.user.bot);
    const totalMembers = members.size;
    let processed = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    const embed = new EmbedBuilder()
      .setTitle("🔄 Syncing Users")
      .setColor(0x0099ff)
      .setDescription(`Processing ${totalMembers} members...`)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    for (const [userId, member] of members) {
      try {
        const existingUser = await dbService.getUser(userId, guild.id);

        if (existingUser && !force) {
          skipped++;
        } else {
          await dbService.createOrUpdateUser(member);
          if (existingUser) {
            updated++;
          } else {
            created++;
          }
        }

        processed++;

        // Update progress every 25 users
        if (processed % 25 === 0) {
          const progressEmbed = new EmbedBuilder()
            .setTitle("🔄 Syncing Users")
            .setColor(0x0099ff)
            .setDescription(`Processing ${totalMembers} members...\n\nProgress: ${processed}/${totalMembers}`)
            .addFields(
              { name: "Created", value: created.toString(), inline: true },
              { name: "Updated", value: updated.toString(), inline: true },
              { name: "Skipped", value: skipped.toString(), inline: true },
              { name: "Errors", value: errors.toString(), inline: true }
            )
            .setTimestamp();

          await interaction.editReply({ embeds: [progressEmbed] });
        }

      } catch (error) {
        console.error(`Error syncing user ${member.user.tag}:`, error);
        errors++;
      }
    }

    const finalEmbed = new EmbedBuilder()
      .setTitle("✅ User Sync Complete")
      .setColor(0x00ff00)
      .setDescription(`Successfully processed ${processed} members`)
      .addFields(
        { name: "Created", value: created.toString(), inline: true },
        { name: "Updated", value: updated.toString(), inline: true },
        { name: "Skipped", value: skipped.toString(), inline: true },
        { name: "Errors", value: errors.toString(), inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [finalEmbed] });

  } catch (error) {
    console.error("Error syncing users:", error);
    await interaction.editReply({
      content: `❌ Error syncing users: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
}

async function handleSyncRoles(interaction: ChatInputCommandInteraction, dbService: DatabaseService) {
  const targetUser = interaction.options.getUser("user");
  const guild = interaction.guild!;

  await interaction.deferReply({ ephemeral: true });

  try {
    if (targetUser) {
      // Sync specific user
      const member = guild.members.cache.get(targetUser.id);
      if (!member) {
        return interaction.editReply({ content: `❌ User ${targetUser.tag} not found in this server.` });
      }

      await dbService.createOrUpdateUser(member);

      const embed = new EmbedBuilder()
        .setTitle("✅ Role Sync Complete")
        .setColor(0x00ff00)
        .setDescription(`Successfully synced roles for ${targetUser.tag}`)
        .addFields(
          { name: "User", value: targetUser.tag, inline: true },
          { name: "Roles", value: member.roles.cache.size.toString(), inline: true },
          { name: "Status", value: "Updated", inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } else {
      // Sync all users' roles
      const members = guild.members.cache.filter(member => !member.user.bot);
      let processed = 0;
      let updated = 0;
      let errors = 0;

      for (const [userId, member] of members) {
        try {
          await dbService.createOrUpdateUser(member);
          updated++;
          processed++;
        } catch (error) {
          console.error(`Error syncing roles for ${member.user.tag}:`, error);
          errors++;
        }
      }

      const embed = new EmbedBuilder()
        .setTitle("✅ Role Sync Complete")
        .setColor(0x00ff00)
        .setDescription(`Successfully synced roles for all users`)
        .addFields(
          { name: "Processed", value: processed.toString(), inline: true },
          { name: "Updated", value: updated.toString(), inline: true },
          { name: "Errors", value: errors.toString(), inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  } catch (error) {
    console.error("Error syncing roles:", error);
    await interaction.editReply({
      content: `❌ Error syncing roles: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
}

async function handleCleanup(interaction: ChatInputCommandInteraction, dbService: DatabaseService) {
  const days = interaction.options.getNumber("days") || 30;
  const guild = interaction.guild!;

  await interaction.deferReply({ ephemeral: true });

  try {
    // Mark inactive users using the public method
    const markedInactive = await dbService.markInactiveUsers(guild.id, days);

    // Find users in database who are no longer in the server
    const serverUserIds = guild.members.cache.map(member => member.id);
    const removedUsers = await dbService.removeUsersNotInServer(guild.id, serverUserIds);

    const embed = new EmbedBuilder()
      .setTitle("🧹 Cleanup Complete")
      .setColor(0x00ff00)
      .setDescription(`Database cleanup completed`)
      .addFields(
        { name: "Inactive Users", value: `Marked ${markedInactive} users inactive (${days} days)`, inline: true },
        { name: "Removed Users", value: `Marked ${removedUsers} users as left`, inline: true },
        { name: "Total Cleaned", value: (markedInactive + removedUsers).toString(), inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error("Error during cleanup:", error);
    await interaction.editReply({
      content: `❌ Error during cleanup: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
}

async function handleSyncStats(interaction: ChatInputCommandInteraction, dbService: DatabaseService) {
  const guild = interaction.guild!;

  try {
    const [userStats, messageStats] = await Promise.all([
      dbService.getUserStats(guild.id),
      dbService.getMessageStats(guild.id)
    ]);

    // Get server member count
    const serverMemberCount = guild.memberCount;
    const botCount = guild.members.cache.filter(member => member.user.bot).size;
    const humanCount = serverMemberCount - botCount;

    // Get database counts using the public method
    const syncStats = await dbService.getSyncStats(guild.id);
    const dbActiveUsers = syncStats.activeUsers;
    const dbInactiveUsers = syncStats.inactiveUsers;

    const embed = new EmbedBuilder()
      .setTitle("📊 Database Sync Statistics")
      .setColor(0x0099ff)
      .setDescription(`Current database state vs server state`)
      .addFields(
        {
          name: "👥 Users",
          value: `**Server:** ${humanCount} humans\n**DB Active:** ${dbActiveUsers}\n**DB Inactive:** ${dbInactiveUsers}\n**Sync Status:** ${dbActiveUsers >= humanCount * 0.9 ? '✅ Good' : '⚠️ Needs Sync'}`,
          inline: true
        },
        {
          name: "💬 Messages",
          value: `**Total:** ${messageStats.totalMessages.toLocaleString()}\n**Deleted:** ${messageStats.deletedMessages.toLocaleString()}\n**Active:** ${(messageStats.totalMessages - messageStats.deletedMessages).toLocaleString()}`,
          inline: true
        },
        {
          name: "📈 Health",
          value: `**Coverage:** ${Math.round((dbActiveUsers / humanCount) * 100)}%\n**Data Quality:** ${messageStats.totalMessages > 0 ? '✅ Good' : '⚠️ No Data'}\n**Last Sync:** ${new Date().toLocaleString()}`,
          inline: true
        }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

  } catch (error) {
    console.error("Error getting sync stats:", error);
    await interaction.reply({
      content: `❌ Error getting sync statistics: ${error instanceof Error ? error.message : 'Unknown error'}`,
      ephemeral: true
    });
  }
}

async function handleFullSync(interaction: ChatInputCommandInteraction, dbService: DatabaseService) {
  const confirm = interaction.options.getBoolean("confirm");

  if (!confirm) {
    return interaction.reply({
      content: "❌ Please confirm you want to perform a full sync by setting the confirm option to true.",
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const guild = interaction.guild!;

    // Step 1: Sync all users
    const members = guild.members.cache.filter(member => !member.user.bot);
    let userCreated = 0;
    let userUpdated = 0;

    for (const [userId, member] of members) {
      try {
        const existingUser = await dbService.getUser(userId, guild.id);
        await dbService.createOrUpdateUser(member);

        if (existingUser) {
          userUpdated++;
        } else {
          userCreated++;
        }
      } catch (error) {
        console.error(`Error syncing user ${member.user.tag}:`, error);
      }
    }

    // Step 2: Sync historical messages
    const historicalMessageStats = await syncHistoricalMessages(interaction, dbService, guild);

    // Step 3: Cleanup inactive users
    const markedInactive = await dbService.markInactiveUsers(guild.id, 30);

    // Step 4: Get final stats
    const [userStats, finalMessageStats] = await Promise.all([
      dbService.getUserStats(guild.id),
      dbService.getMessageStats(guild.id)
    ]);

    const embed = new EmbedBuilder()
      .setTitle("🔄 Full Sync Complete")
      .setColor(0x00ff00)
      .setDescription(`Database has been fully synchronized with server state`)
      .addFields(
        { name: "👥 Users", value: `Created: ${userCreated}\nUpdated: ${userUpdated}\nMarked Inactive: ${markedInactive}`, inline: true },
        { name: "💬 Messages", value: `Synced: ${historicalMessageStats.synced}\nSkipped: ${historicalMessageStats.skipped}\nErrors: ${historicalMessageStats.errors}`, inline: true },
        { name: "📊 Database", value: `Active Users: ${userStats.activeUsers}\nTotal Messages: ${finalMessageStats.totalMessages.toLocaleString()}\nDeleted Messages: ${finalMessageStats.deletedMessages.toLocaleString()}`, inline: true }
      )
      .addFields(
        { name: "✅ Status", value: "Full sync completed successfully\nAll data is now synchronized\nDatabase is up to date", inline: false }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error("Error during full sync:", error);
    await interaction.editReply({
      content: `❌ Error during full sync: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
}

async function handleVerifySync(interaction: ChatInputCommandInteraction, dbService: DatabaseService) {
  const guild = interaction.guild!;

  await interaction.deferReply({ ephemeral: true });

  try {
    const embed = new EmbedBuilder()
      .setTitle("🔍 Verifying Sync Completeness")
      .setColor(0x0099ff)
      .setDescription("Analyzing database integrity and sync completeness...")
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // Get comprehensive verification data
    const [
      channelCounts,
      oldestMessage,
      newestMessage,
      userCounts,
      totalChars,
      messageStats,
      userStats
    ] = await Promise.all([
      dbService.getChannelMessageCounts(guild.id),
      dbService.getOldestMessage(guild.id),
      dbService.getNewestMessage(guild.id),
      dbService.getMessageCountByUser(guild.id),
      dbService.getTotalCharacterCount(guild.id),
      dbService.getMessageStats(guild.id),
      dbService.getUserStats(guild.id)
    ]);

    // Get server channels for comparison
    const serverChannels = guild.channels.cache.filter(
      (channel: any) => channel.type === 0 && channel.permissionsFor(guild.members.me).has('ViewChannel')
    );

    // Calculate verification metrics
    const totalChannels = serverChannels.size;
    const channelsWithMessages = Object.keys(channelCounts).length;
    const channelCoverage = Math.round((channelsWithMessages / totalChannels) * 100);

    // Get top channels by message count
    const topChannels = Object.entries(channelCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([channelId, count]) => {
        const channel = guild.channels.cache.get(channelId);
        return `#${channel?.name || 'Unknown'}: ${count.toLocaleString()}`;
      });

    // Get top users by message count
    const topUsers = Object.entries(userCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([userId, count]) => {
        const user = guild.members.cache.get(userId);
        return `${user?.user.tag || 'Unknown'}: ${count.toLocaleString()}`;
      });

    // Calculate data quality metrics
    const avgCharsPerMessage = messageStats.totalMessages > 0 ? Math.round(totalChars / messageStats.totalMessages) : 0;
    const dataQuality = messageStats.totalMessages > 1000 ? '✅ Excellent' :
      messageStats.totalMessages > 100 ? '✅ Good' :
        messageStats.totalMessages > 10 ? '⚠️ Limited' : '❌ Insufficient';

    const verificationEmbed = new EmbedBuilder()
      .setTitle("✅ Sync Verification Complete")
      .setColor(0x00ff00)
      .setDescription("Database integrity and sync completeness analysis")
      .addFields(
        {
          name: "📊 Overall Statistics",
          value: `**Total Messages:** ${messageStats.totalMessages.toLocaleString()}\n**Total Characters:** ${totalChars.toLocaleString()}\n**Avg Chars/Message:** ${avgCharsPerMessage}\n**Data Quality:** ${dataQuality}`,
          inline: true
        },
        {
          name: "📅 Time Range",
          value: `**Oldest:** ${oldestMessage ? `<t:${Math.floor(oldestMessage.getTime() / 1000)}:R>` : 'None'}\n**Newest:** ${newestMessage ? `<t:${Math.floor(newestMessage.getTime() / 1000)}:R>` : 'None'}\n**Span:** ${oldestMessage && newestMessage ? Math.round((newestMessage.getTime() - oldestMessage.getTime()) / (1000 * 60 * 60 * 24)) : 0} days`,
          inline: true
        },
        {
          name: "📈 Coverage",
          value: `**Channels:** ${channelsWithMessages}/${totalChannels} (${channelCoverage}%)\n**Users:** ${Object.keys(userCounts).length}/${userStats.activeUsers}\n**Sync Status:** ${channelCoverage >= 90 ? '✅ Complete' : '⚠️ Partial'}`,
          inline: true
        }
      )
      .setTimestamp();

    // Add top channels if we have data
    if (topChannels.length > 0) {
      verificationEmbed.addFields({
        name: "🏆 Top Channels by Messages",
        value: topChannels.join('\n'),
        inline: false
      });
    }

    // Add top users if we have data
    if (topUsers.length > 0) {
      verificationEmbed.addFields({
        name: "👥 Top Users by Messages",
        value: topUsers.join('\n'),
        inline: false
      });
    }

    // Add verification status
    const verificationStatus = [];
    if (channelCoverage >= 90) verificationStatus.push('✅ Channel coverage excellent');
    else if (channelCoverage >= 70) verificationStatus.push('⚠️ Channel coverage good');
    else verificationStatus.push('❌ Channel coverage needs improvement');

    if (messageStats.totalMessages > 1000) verificationStatus.push('✅ Message volume excellent');
    else if (messageStats.totalMessages > 100) verificationStatus.push('⚠️ Message volume moderate');
    else verificationStatus.push('❌ Message volume low');

    if (oldestMessage && newestMessage) {
      const daysSpan = (newestMessage.getTime() - oldestMessage.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSpan > 30) verificationStatus.push('✅ Good historical coverage');
      else if (daysSpan > 7) verificationStatus.push('⚠️ Limited historical coverage');
      else verificationStatus.push('❌ Minimal historical coverage');
    }

    verificationEmbed.addFields({
      name: "🔍 Verification Status",
      value: verificationStatus.join('\n'),
      inline: false
    });

    await interaction.editReply({ embeds: [verificationEmbed] });

  } catch (error) {
    console.error("Error during verification:", error);
    await interaction.editReply({
      content: `❌ Error during verification: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
}

async function handleSyncMessages(interaction: ChatInputCommandInteraction, dbService: DatabaseService) {
  const guild = interaction.guild!;

  await interaction.deferReply({ ephemeral: true });

  try {
    const embed = new EmbedBuilder()
      .setTitle("🔄 Syncing Messages")
      .setColor(0x0099ff)
      .setDescription("Starting historical message synchronization...")
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    const messageStats = await syncHistoricalMessages(interaction, dbService, guild);

    const finalEmbed = new EmbedBuilder()
      .setTitle("✅ Message Sync Complete")
      .setColor(0x00ff00)
      .setDescription(`Successfully synchronized historical messages`)
      .addFields(
        { name: "Synced", value: messageStats.synced.toString(), inline: true },
        { name: "Skipped", value: messageStats.skipped.toString(), inline: true },
        { name: "Errors", value: messageStats.errors.toString(), inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [finalEmbed] });

  } catch (error) {
    console.error("Error syncing messages:", error);
    await interaction.editReply({
      content: `❌ Error syncing messages: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
}

// Helper function to sync historical messages
async function syncHistoricalMessages(
  interaction: ChatInputCommandInteraction,
  dbService: DatabaseService,
  guild: any
): Promise<{ synced: number; skipped: number; errors: number }> {
  let synced = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // Get all text channels in the guild
    const textChannels = guild.channels.cache.filter(
      (channel: any) => channel.type === 0 && channel.permissionsFor(guild.members.me).has('ViewChannel')
    );

    console.log(`📝 Starting historical message sync for ${textChannels.size} channels...`);

    for (const [channelId, channel] of textChannels) {
      try {
        console.log(`📝 Syncing messages from #${channel.name}...`);

        let lastMessageId: string | undefined;
        let channelSynced = 0;
        let channelSkipped = 0;
        let channelErrors = 0;
        let totalProcessed = 0;

        // Fetch messages in batches of 100 (Discord API limit)
        while (true) {
          const options: any = { limit: 100 };
          if (lastMessageId) {
            options.before = lastMessageId;
          }

          const messages = await channel.messages.fetch(options);

          if (messages.size === 0) break;

          for (const [messageId, message] of messages) {
            try {
              // Skip bot messages
              if (message.author.bot) {
                channelSkipped++;
                continue;
              }

              // Check if message already exists in database
              const messageExists = await dbService.messageExists(messageId);

              if (messageExists) {
                channelSkipped++;
                continue;
              }

              // Create message in database
              await dbService.createMessage(message);
              channelSynced++;

              // Update user's message count
              await dbService.incrementMessageCount(message.author.id, guild.id);

            } catch (error) {
              console.error(`Error syncing message ${messageId}:`, error);
              channelErrors++;
            }

            totalProcessed++;
          }

          // Update last message ID for pagination
          lastMessageId = messages.last()?.id;

          // Break if we got fewer messages than the limit (end of channel)
          if (messages.size < 100) break;

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        synced += channelSynced;
        skipped += channelSkipped;
        errors += channelErrors;

        console.log(`✅ #${channel.name}: ${channelSynced} synced, ${channelSkipped} skipped, ${channelErrors} errors (${totalProcessed} total processed)`);

      } catch (error) {
        console.error(`Error syncing channel #${channel.name}:`, error);
        errors++;
      }
    }

    console.log(`📝 Historical message sync complete: ${synced} synced, ${skipped} skipped, ${errors} errors`);

  } catch (error) {
    console.error("Error during historical message sync:", error);
    errors++;
  }

  return { synced, skipped, errors };
}
