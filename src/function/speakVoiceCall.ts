import { Client, Guild, VoiceState } from "discord.js";
import { exec } from "child_process";

export async function speakVoiceCall(guild: Guild, client: Client) {
    // Check if the listener is already added
    if (client.listenerCount("voiceStateUpdate") === 0) {
        client.on(
            "voiceStateUpdate",
            (oldState: VoiceState, newState: VoiceState) => {
                // Check if the event is for the specified guild
                if (oldState.guild.id !== guild.id) return;

                const user = newState.member?.user;

                // Function to execute the command
                const executeCommand = (input: string) => {
                    exec(
                        `/home/ln64/Documents/Scripts/voxctl -input "${input}"`,
                        (error, stdout, stderr) => {
                            if (error) {
                                console.error(
                                    `Error executing command: ${error.message}`,
                                );
                                return;
                            }
                            if (stderr) {
                                console.error(`stderr: ${stderr}`);
                                return;
                            }
                            console.log(`stdout: ${stdout}`);
                        },
                    );
                };

                // Detect meaningful changes to channelId
                const oldChannelId = oldState.channelId;
                const newChannelId = newState.channelId;

                if (oldChannelId !== newChannelId) {
                    if (!oldChannelId && newChannelId) {
                        // User joined a voice channel
                        executeCommand(
                            `${user?.displayName} joined ${newState.channel?.name}`,
                        );
                    } else if (oldChannelId && !newChannelId) {
                        // User left a voice channel
                        executeCommand(
                            `${user?.displayName} left ${oldState.channel?.name}`,
                        );
                    } else if (oldChannelId && newChannelId) {
                        // User switched voice channels
                        executeCommand(
                            `${user?.displayName} switched from ${oldState.channel?.name} to ${newState.channel?.name}`,
                        );
                    }
                }
            },
        );
    }
}
