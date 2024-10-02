// discordClient.d.ts
import { Client } from 'discord.js';
import { Collection } from 'discord.js';
import { CommandInteraction } from 'discord.js';

declare module 'discord.js' {
  export interface Client {
    commands: Collection<string, Command>;
  }
}

export interface Command {
  name: string;
  description: string;
  execute(interaction: CommandInteraction): Promise<void>;
}
