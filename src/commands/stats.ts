import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { DatabaseService } from "../services/DatabaseService.js";

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("View server statistics and user data")
  .addSubcommand(subcommand =>
    subcommand
      .setName("server")
      .setDescription("View server statistics")
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName("user")
      .setDescription("View user statistics with ranking")
      .addUserOption(option =>
        option
          .setName("user")
          .setDescription("The user to view stats for")
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName("leaderboard")
      .setDescription("View server leaderboard (top 10 users)")
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName("roles")
      .setDescription("View role history for a user")
      .addUserOption(option =>
        option
          .setName("user")
          .setDescription("The user to view role history for")
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
      case "server":
        await handleServerStats(interaction, dbService);
        break;
      case "user":
        await handleUserStats(interaction, dbService);
        break;
      case "leaderboard":
        await handleLeaderboard(interaction, dbService);
        break;
      case "roles":
        await handleRoleHistory(interaction, dbService);
        break;
    }
  } catch (error) {
    console.error("Error in stats command:", error);
    await interaction.reply({ content: "❌ An error occurred while fetching statistics.", ephemeral: true });
  }
}

async function handleServerStats(interaction: ChatInputCommandInteraction, dbService: DatabaseService) {
  const guildId = interaction.guild!.id;

  const [userStats, messageStats] = await Promise.all([
    dbService.getUserStats(guildId),
    dbService.getMessageStats(guildId)
  ]);

  const embed = new EmbedBuilder()
    .setTitle(`📊 Server Statistics - ${interaction.guild!.name}`)
    .setColor(0x00ff00)
    .addFields(
      { name: "👥 Users", value: `Total: ${userStats.totalUsers}\nActive: ${userStats.activeUsers}`, inline: true },
      { name: "💬 Messages", value: `Total: ${messageStats.totalMessages}\nDeleted: ${messageStats.deletedMessages}`, inline: true },
      { name: "📈 Activity", value: `Active Rate: ${((userStats.activeUsers / userStats.totalUsers) * 100).toFixed(1)}%`, inline: true }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleUserStats(interaction: ChatInputCommandInteraction, dbService: DatabaseService) {
  const targetUser = interaction.options.getUser("user") || interaction.user;
  const guildId = interaction.guild!.id;

  // First check if user exists in database
  const userExists = await dbService.getUser(targetUser.id, guildId);
  if (!userExists) {
    return interaction.reply({
      content: `❌ No data found for ${targetUser.tag} in this server.\n\n💡 Try using \`/init-user\` to create user data first.`,
      ephemeral: true
    });
  }

  const userStats = await dbService.getUserStatsWithRanking(guildId, targetUser.id, 30);

  if (!userStats) {
    return interaction.reply({
      content: `❌ Error calculating stats for ${targetUser.tag}.`,
      ephemeral: true
    });
  }

  const rankEmoji = getRankEmoji(userStats.rank);
  const percentile = Math.round(((userStats.totalUsers - userStats.rank + 1) / userStats.totalUsers) * 100);

  const embed = new EmbedBuilder()
    .setTitle(`${rankEmoji} User Statistics - ${targetUser.tag}`)
    .setThumbnail(targetUser.displayAvatarURL())
    .setColor(getRankColor(userStats.rank))
    .setDescription(`**Ranking based on last 7 days activity**`)
    .addFields(
      {
        name: "🏆 Ranking",
        value: `**#${userStats.rank}** of ${userStats.totalUsers} users\n*Top ${percentile}%*`,
        inline: true
      },
      {
        name: "📊 Last 30 Days",
        value: `**Messages:** ${userStats.messageCount.toLocaleString()}\n**Characters:** ${userStats.characterCount.toLocaleString()}\n**VC Time:** ${userStats.vcHours}h`,
        inline: true
      },
      {
        name: "📈 Activity Breakdown",
        value: `**Avg per day:** ${Math.round(userStats.messageCount / 30)} msgs\n**Avg per day:** ${Math.round(userStats.characterCount / 30)} chars\n**Avg per day:** ${Math.round(userStats.vcMinutes / 30)} min`,
        inline: true
      }
    )
    .setFooter({ text: "Ranking based on VC time (30%) + message characters (70%)" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleLeaderboard(interaction: ChatInputCommandInteraction, dbService: DatabaseService) {
  const guildId = interaction.guild!.id;

  const rankings = await dbService.calculateUserRankings(guildId, 7);
  const top10 = rankings.slice(0, 10);

  if (top10.length === 0) {
    return interaction.reply({
      content: "❌ No activity data found for the last 7 days.",
      ephemeral: true
    });
  }

  const embed = new EmbedBuilder()
    .setTitle("🏆 Server Leaderboard - Last 7 Days")
    .setColor(0xffd700)
    .setDescription("Top users based on VC time and message activity")
    .setTimestamp();

  const leaderboardText = top10.map((user, index) => {
    const rankEmoji = getRankEmoji(user.rank);
    const vcHours = Math.round((user.vcMinutes / 60) * 100) / 100;
    const avgChars = Math.round(user.characterCount / Math.max(user.messageCount, 1));

    return `${rankEmoji} **#${user.rank}** ${user.username}\n` +
      `   📝 ${user.messageCount} msgs • ${user.characterCount.toLocaleString()} chars • ${vcHours}h VC\n` +
      `   📊 Avg: ${avgChars} chars/msg • Score: ${Math.round(user.combinedScore)}`;
  }).join('\n\n');

  embed.addFields({
    name: "Top 10 Users",
    value: leaderboardText,
    inline: false
  });

  embed.setFooter({ text: "Ranking: VC time (30%) + message characters (70%)" });

  await interaction.reply({ embeds: [embed] });
}

async function handleRoleHistory(interaction: ChatInputCommandInteraction, dbService: DatabaseService) {
  const targetUser = interaction.options.getUser("user")!;
  const guildId = interaction.guild!.id;

  const roleHistory = await dbService.getRoleHistory(targetUser.id, guildId);

  if (roleHistory.length === 0) {
    return interaction.reply({
      content: `❌ No role history found for ${targetUser.tag}.`,
      ephemeral: true
    });
  }

  const recentHistory = roleHistory.slice(0, 10); // Show last 10 role changes

  const embed = new EmbedBuilder()
    .setTitle(`🎭 Role History - ${targetUser.tag}`)
    .setThumbnail(targetUser.displayAvatarURL())
    .setColor(0xff9900)
    .setDescription("Recent role changes:")
    .setTimestamp();

  for (const change of recentHistory) {
    const action = change.action === 'added' ? '🔹' : '🔸';
    const time = `<t:${Math.floor(change.timestamp.getTime() / 1000)}:R>`;
    embed.addFields({
      name: `${action} ${change.roleName}`,
      value: `${change.action} ${time}`,
      inline: true
    });
  }

  if (roleHistory.length > 10) {
    embed.setFooter({ text: `Showing 10 of ${roleHistory.length} role changes` });
  }

  await interaction.reply({ embeds: [embed] });
}

// Helper functions
function getRankEmoji(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  if (rank <= 5) return "🏅";
  if (rank <= 10) return "🔹";
  if (rank <= 25) return "🔸";
  return "📊";
}

function getRankColor(rank: number): number {
  if (rank === 1) return 0xffd700; // Gold
  if (rank === 2) return 0xc0c0c0; // Silver
  if (rank === 3) return 0xcd7f32; // Bronze
  if (rank <= 5) return 0x00ff00; // Green
  if (rank <= 10) return 0x0099ff; // Blue
  if (rank <= 25) return 0xff9900; // Orange
  return 0x666666; // Gray
}
