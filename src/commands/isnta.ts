import {
    AttachmentBuilder,
    ChatInputCommandInteraction,
    SlashCommandBuilder,
} from "discord.js";
import { spawn } from "child_process";
import { existsSync, readdirSync, rmdirSync, unlinkSync } from "fs";
import { join } from "path";

export const data = new SlashCommandBuilder()
    .setName("insta")
    .setDescription(
        "Download an Instagram carousel or single post via instaloader",
    )
    .addStringOption((option) =>
        option
            .setName("url")
            .setDescription(
                "Instagram post or reel URL (may contain multiple videos)",
            )
            .setRequired(true)
    );

/**
 * Execute function for the `/insta` slash command.
 */
export async function execute(interaction: ChatInputCommandInteraction) {
    const igUrl = interaction.options.getString("url", true);

    // Quick check if it's an instagram.com/p/ or /reel/ link
    if (!/instagram\.com\/(p|reel)\//.test(igUrl)) {
        await interaction.reply({
            content:
                "That doesn't look like a valid Instagram post or reel URL.",
            ephemeral: true,
        });
        return;
    }

    // Defer reply so we have time to run instaloader
    await interaction.deferReply();

    // 1) Extract the post shortcode from the URL (e.g. "ABCxyz1234")
    let shortcode: string;
    try {
        shortcode = extractShortcodeFromUrl(igUrl);
    } catch (err) {
        console.error("Failed to parse shortcode from URL:", err);
        await interaction.editReply(
            "Could not parse a valid post/reel shortcode from that URL.",
        );
        return;
    }

    // 2) Create a unique folder to download into
    const downloadFolder = join(
        __dirname,
        "..",
        "..",
        "temp",
        `insta_download_${Date.now()}`,
    );

    try {
        // 3) Run Instaloader as a child process
        const result = await downloadWithInstaloader(shortcode, downloadFolder);

        // If instaloader fails or returns an error code, handle it
        if (!result.success) {
            throw new Error("instaloader process failed.");
        }

        // 4) Locate *all* the downloaded MP4 files
        const mp4Files = readdirSync(downloadFolder).filter((f) =>
            f.endsWith(".mp4")
        );
        if (mp4Files.length === 0) {
            throw new Error(
                "No .mp4 files found. " +
                    "Possibly it's an image-only post or private (requires login).",
            );
        }

        // Build an array of Attachments for each .mp4
        const attachments = mp4Files.map((file, index) => {
            const mp4FilePath = join(downloadFolder, file);
            return new AttachmentBuilder(mp4FilePath, {
                name: `video${index}.mp4`,
            });
        });

        // 5) Upload all videos to Discord in a single message
        await interaction.editReply({ files: attachments });
    } catch (err) {
        console.error(
            "Error downloading Instagram post with instaloader:",
            err,
        );
        await interaction.editReply(
            "Failed to download the post. It may be private or not a video post.",
        );
    } finally {
        // 6) Clean up the folder and its contents
        cleanUpFolder(downloadFolder);
    }
}

/**
 * Extracts the post shortcode from an Instagram URL.
 * e.g. "https://www.instagram.com/p/ABCxyz1234/" => "ABCxyz1234"
 */
function extractShortcodeFromUrl(igUrl: string): string {
    // Match the segment after "/p/" or "/reel/"
    const match = igUrl.match(/instagram\.com\/(?:p|reel)\/([^\/]+)/);
    if (!match) {
        throw new Error("Shortcode not found in URL");
    }
    // Remove any possible query parameters, e.g. "?img_index=1"
    return match[1].split("?")[0];
}

/**
 * Spawns instaloader to download a post (may have multiple slides).
 * NOTE: We removed --only-if=is_video to allow partial image/video carousels.
 */
function downloadWithInstaloader(
    shortcode: string,
    downloadFolder: string,
): Promise<{ success: boolean }> {
    return new Promise((resolve) => {
        const args = [
            `--dirname-pattern=${downloadFolder}`,
            `--filename-pattern={shortcode}_{media_id}`, // help differentiate multiple slides
            "--no-captions",
            "--no-compress-json",
            // Removed "--only-if=is_video" so we can handle all slides
            shortcode,
        ];

        const proc = spawn("instaloader", args);

        // Capture stdout for debugging
        proc.stdout.on("data", (data) => {
            console.log("[Instaloader stdout]", data.toString());
        });

        // Capture stderr for debugging
        proc.stderr.on("data", (data) => {
            console.error("[Instaloader stderr]", data.toString());
        });

        // When process closes, check exit code
        proc.on("close", (code) => {
            resolve({ success: code === 0 });
        });
    });
}

/**
 * Recursively remove the folder and its contents.
 * A simple approach that calls fs.readdirSync, fs.unlinkSync, then fs.rmdirSync.
 */
function cleanUpFolder(folderPath: string) {
    if (!existsSync(folderPath)) return;

    for (const file of readdirSync(folderPath)) {
        unlinkSync(join(folderPath, file));
    }
    rmdirSync(folderPath);
}
