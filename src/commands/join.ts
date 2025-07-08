import { exec } from "child_process";
import * as fs from "fs";
import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { joinVoiceChannel, EndBehaviorType } from "@discordjs/voice";
import prism from "prism-media";

export const data = new SlashCommandBuilder()
  .setName("join")
  .setDescription("Bot joins your current voice channel and records audio.");

export async function execute(interaction: ChatInputCommandInteraction) {
  console.log("[/join command] Handler called");
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  if (!member?.voice.channel) {
    await interaction.reply({ content: "Join a VC first", ephemeral: true });
    return;
  }
  if (!interaction.guild || !interaction.guild.id || !interaction.guild.voiceAdapterCreator) {
    await interaction.reply({ content: "Guild information is missing.", ephemeral: true });
    return;
  }

  await interaction.reply("Joined and listening!");

  const connection = joinVoiceChannel({
    channelId: member.voice.channel.id,
    guildId: interaction.guild.id,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: false,
  });

  const receiver = connection.receiver;

  receiver.speaking.on("start", (userId) => {
    const opusStream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 100 } });
    // Opus decode using prism-media, always output mono
    const pcmStream = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
    const filename = `./audio-${userId}-${Date.now()}.pcm`;
    const writeStream = fs.createWriteStream(filename);
    opusStream.pipe(pcmStream).pipe(writeStream);

    writeStream.on("finish", () => {
      fs.stat(filename, (err, stats) => {
        if (err || stats.size < 8000) {
          console.log(`[${userId}] File too short, skipping.`);
          return;
        }
        console.log(`Saved audio for user ${userId} to ${filename}`);

        const wavFile = filename.replace('.pcm', '.wav');
        exec(`ffmpeg -y -f s16le -ar 48000 -ac 1 -i ${filename} ${wavFile}`, (ffmpegErr) => {
          if (ffmpegErr) {
            console.error("ffmpeg error:", ffmpegErr);
            return;
          }
          exec(`/usr/bin/whisper-cli -m /home/ln64/.config/whisper/models/ggml-small.bin -f ${wavFile} -otxt`, (whisperErr, stdout, stderr) => {
            if (whisperErr) {
              console.error("Whisper.cpp error:", whisperErr, stderr);
              return;
            }
            const txtFile = wavFile + ".txt";
            fs.readFile(txtFile, "utf8", (readErr, transcript) => {
              if (readErr) {
                console.error("Transcript read error:", readErr);
              } else {
                if (transcript.trim().length === 0) {
                  console.log(`📝 Whisper transcript for ${userId}: [BLANK_AUDIO]`);
                } else {
                  console.log(`📝 Whisper transcript for ${userId}:`, transcript.trim());
                }
              }
            });
          });
        });
      });
    });
  });
}