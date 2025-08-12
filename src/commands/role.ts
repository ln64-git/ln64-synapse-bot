import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    GuildMember,
} from "discord.js";

const TOGGLEABLE_ROLE_NAMES = [
    "Fortnite",
    "Repo",
    "Movies",
    "vc ping",
    "Lethal Company",
    "Peak",
    "Lockdown Protocol",
];

export const data = new SlashCommandBuilder()
    .setName("role")
    .setDescription("Toggle role.")
    .addStringOption(option =>
        option
            .setName("role")
            .setDescription("The role to toggle")
            .setRequired(true)
            .addChoices(
                ...TOGGLEABLE_ROLE_NAMES.map(name => ({ name, value: name }))
            )
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
        return interaction.reply({ content: "This command only works in servers.", ephemeral: true });
    }

    const member = interaction.member as GuildMember;
    const roleName = interaction.options.getString("role", true);
    const role = interaction.guild!.roles.cache.find(r => r.name === roleName);

    if (!role) {
        return interaction.reply({ content: `❌ Role "${roleName}" not found in this server.`, ephemeral: true });
    }

    // Permission check
    if (role.managed || role.position >= interaction.guild!.members.me!.roles.highest.position) {
        return interaction.reply({ content: `⚠️ I don't have permission to modify the "${roleName}" role.`, ephemeral: true });
    }

    const hasRole = member.roles.cache.has(role.id);

    if (hasRole) {
        await member.roles.remove(role);
        return interaction.reply({ content: `✅ Removed the "${roleName}" role.`, ephemeral: true });
    } else {
        await member.roles.add(role);
        return interaction.reply({ content: `✅ Added the "${roleName}" role.`, ephemeral: true });
    }
}
