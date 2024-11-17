import OpenAI from "openai";
import dotenv from "dotenv";

// Initialize OpenAI client

dotenv.config();
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, // Ensure your API key is set in your environment variables
});

export async function callModel(
    prompt: string,
): Promise<string> {
    try {
        // Use OpenAI's chat completions endpoint for conversation
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo", // Replace with your preferred model
            messages: [{ role: "user", content: prompt }],
        });
        // Return the content of the first choice
        const content = response.choices[0].message.content;
        if (content === null) {
            throw new Error("Model response content is null");
        }
        return content;
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to call model: ${error.message}`);
        } else {
            throw new Error("Failed to call model: Unknown error");
        }
    }
}
