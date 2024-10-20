import { ChatInputCommandInteraction, GuildMember } from "discord.js";
import path from "path";
import fs from "fs";
import { AttachmentBuilder } from "discord.js";

export async function handleResult(
    interaction: ChatInputCommandInteraction,
    user: GuildMember,
    outputData: string,
): Promise<void> {
    try {
        // Discord messages have a 2000 character limit, check the size
        // if (outputData.length <= 2000) {
        //     await sendResultToDiscord(interaction, user, outputData);
        // } else {
        // }
        await saveResultToFile(interaction, user, outputData);
        await interaction.editReply(
            `Sentiment analysis for ${user} exceeds Discord's character limit. The analysis has been saved to a file.`,
        );
    } catch (error) {
        console.log("Error handling report data:", String(error));
        await interaction.editReply(
            "There was an error handling the analysis result.",
        );
    }
}

export async function sendResultToDiscord(
    interaction: ChatInputCommandInteraction,
    user: GuildMember,
    outputData: string,
): Promise<void> {
    try {
        await interaction.editReply(
            `**Sentiment analysis for ${user}:**\n${outputData}`,
        );
    } catch (error) {
        console.error("Error sending report data to Discord:", error);
        throw new Error(
            "There was an error sending the report data to Discord.",
        );
    }
}

export async function saveResultToFile(
    interaction: ChatInputCommandInteraction,
    user: GuildMember,
    outputData: string,
): Promise<void> {
    try {
        const outputDir = path.resolve(__dirname, "../../output");
        const filePath = path.join(outputDir, `${user}_analysis.txt`);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        fs.writeFileSync(filePath, outputData, "utf-8"); // Updated the variable name
        console.log(`Report saved to ${filePath}`);
        // const attachment = new AttachmentBuilder(filePath, {
        //     name: `${username}_analysis.txt`,
        // });
        // await interaction.editReply({
        //     content: `Sentiment analysis for ${username} exceeds Discord's character limit. Please find the analysis attached.`,
        //     files: [attachment],
        // });
    } catch (error) {
        console.error("Error saving report data to file:", error);
        throw new Error("There was an error saving the report data to file.");
    }
}
