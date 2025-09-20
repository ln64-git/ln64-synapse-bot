import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder, escapeMarkdown } from "discord.js";
import { TOGGLEABLE_ROLE_NAMES } from "./role";

export const data = new SlashCommandBuilder()
  .setName("view-role")
  .setDescription("View list of users with a given role")
  .addStringOption(option =>
    option
      .setName("role")
      .setDescription("Role to view")
      .setRequired(true)
      .addChoices(...TOGGLEABLE_ROLE_NAMES.map(name => ({ name, value: name })))
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  context?: { db: any, client: any, databaseService: any }
) {
  if (!interaction.guild) {
    await interaction.reply("This command can only be used in a server.");
    return;
  }

  const roleName = interaction.options.getString("role", true);
  const role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
  if (!role) {
    await interaction.reply({ content: `Role "${roleName}" not found.`, flags: 64 });
    return;
  }
  // Fetch all members with the specified role
  const membersWithRole = await interaction.guild.members.fetch().then(members =>
    members.filter(member => member.roles.cache.has(role.id))
  );
  // Prepare a clean Markdown bullet list inside an embed
  const names = membersWithRole
    .map(member => member.displayName)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const lines = names.map(n => `- ${escapeMarkdown(n)}`);

  const MAX_DESCRIPTION = 4096; // Discord embed description limit
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > MAX_DESCRIPTION) {
      if (current.length === 0) {
        // Extremely long single line; hard cut to avoid infinite loop
        chunks.push(line.slice(0, MAX_DESCRIPTION));
        current = "";
      } else {
        chunks.push(current);
        current = line;
      }
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);

  const embeds = chunks.map((desc, idx) =>
    new EmbedBuilder()
      .setTitle(
        `Members with the role ${role.name} (${membersWithRole.size})${chunks.length > 1 ? ` — page ${idx + 1}/${chunks.length}` : ""}`
      )
      .setDescription(desc)
      .setColor(role.color || 0x5865f2)
  );

  await interaction.reply({ embeds, flags: 64 });
}
