import { readdir } from "fs/promises";
import { join } from "path";

export async function loadCommands(commands: any) {
    const commandFiles = await readdir(join(__dirname, "../commands"));

    for (const file of commandFiles) {
        if (file.endsWith(".ts")) {
            const { data, execute } = await import(`../commands/${file}`);
            commands.set(data.name, { data, execute });
        }
    }
}
