import { Filter } from "bad-words";
import { callModel } from "../../../lib/openai/openai";

const filter = new Filter();

export async function extractKeywordsWithOpenAi(
    content: string,
): Promise<string[]> {
    if (!content.trim()) return [];
    try {
        const aiResponse = await callModel(generateKeywordPrompt(content));
        let keywords = extractJsonArray(aiResponse) ??
            parseFallback(aiResponse);

        keywords = keywords
            .map((word) => word.toLowerCase().replace(/[^a-zA-Z0-9 ]/g, "")) // Normalize words
            .filter((word) =>
                !filter.isProfane(word) &&
                !offensivePhrases.some((p) => word.includes(p))
            )
            .filter((word) => !unwantedKeywords.includes(word))
            .filter((word) => word.length >= 2 && word.length <= 50); // Length constraints

        return Array.from(new Set(keywords)); // Remove duplicates
    } catch (error) {
        console.error("Error extracting keywords with AI:", error);
        return [];
    }
}

/** Generates OpenAI prompt */
const generateKeywordPrompt = (content: string) => `
Extract the 5 most relevant non-offensive keywords from the following message. 
Exclude stopwords, offensive terms, and generic words like "discord" or "keywords." 
Return the keywords as a JSON array **only**, no explanations.

Message: "${content}"

Keywords:
\`\`\`json
["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"]
\`\`\`
`;

/** Attempts to extract a JSON array from AI response */
const extractJsonArray = (aiResponse: string): string[] | null => {
    const match = aiResponse.match(/```json\s*\n([\s\S]*?)\n```/);
    try {
        return match ? JSON.parse(match[1]) : null;
    } catch {
        console.warn("Failed to parse JSON response.");
        return null;
    }
};

/** Fallback extraction by splitting lines */
const parseFallback = (aiResponse: string): string[] =>
    aiResponse
        .split("\n")
        .map((line) => line.replace(/^-+\s*/, "").trim()) // Remove hyphens
        .filter((word) => word.length > 0);

// List of offensive words and phrases
const offensiveTerms = [
    "stfu",
    "nigger",
    "n1gger",
    "nigg3r",
    "shit",
    "sh!t",
    "fucking",
    "fuck",
    "f@ck",
    "fucked",
    "bitch",
    "ass",
    "junkie",
    "slut",
    "tits",
    "raped",
    "neo nazis",
];
const unwantedKeywords = ["discord", "message", "top", "relevant", "keywords"];
const offensivePhrases = ["neo nazis"];
offensiveTerms.forEach((term) => filter.addWords(term));
