import { Client, Guild, VoiceState } from "discord.js";
import { exec } from "child_process";

export async function speakVoiceCall(client: Client) {
    // Check if the listener is already added
    if (client.listenerCount("voiceStateUpdate") === 0) {
        client.on(
            "voiceStateUpdate",
            (oldState: VoiceState, newState: VoiceState) => {
                const guild = newState.guild; // Get the guild of the event
                const user = newState.member?.user;

                // Function to execute the command
                const executeCommand = (input: string) => {
                    exec(
                        `/home/ln64/Source/qtts/qtts -port 2001 -input "${input}"`,
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
                    // Utility function to remove emojis
                    const removeEmojis = (str: string | undefined) =>
                        str?.replace(
                            /[\p{Emoji}\p{Extended_Pictographic}]/gu,
                            "",
                        ) || "";

                    const userName = removeEmojis(user?.displayName);
                    const oldChannelName = removeEmojis(oldState.channel?.name);
                    const newChannelName = removeEmojis(newState.channel?.name);

                    if (!oldChannelId && newChannelId) {
                        // User joined a voice channel
                        executeCommand(
                            `${userName} joined ${newChannelName} in ${guild.name}`,
                        );
                    } else if (oldChannelId && !newChannelId) {
                        // User left a voice channel
                        executeCommand(
                            `${userName} left ${oldChannelName} in ${guild.name}`,
                        );
                    } else if (oldChannelId && newChannelId) {
                        // User switched voice channels
                        executeCommand(
                            `${userName} switched from ${oldChannelName} to ${newChannelName} in ${guild.name}`,
                        );
                    }
                }
            },
        );
    }
}
