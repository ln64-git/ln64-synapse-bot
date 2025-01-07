// extractKeywords.ts

import OpenAI from "openai";
import { Filter } from "bad-words";
import dotenv from "dotenv";

dotenv.config();

// Initialize OpenAI client
const openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Function to call OpenAI's GPT-3.5-turbo model for keyword extraction.
 * @param content - The raw message content.
 * @returns An array of extracted keywords.
 */
export async function extractKeywordsWithAI(
    content: string,
): Promise<string[]> {
    const prompt = `
    Extract the top 5 most relevant and non-offensive keywords from the following Discord message. **Do not include** any offensive language, including variations or misspellings, common stopwords, or the words "Discord", "message", "top", "relevant", or "keywords" unless they are explicitly mentioned in the message content. Ensure that the keywords are meaningful and contextually significant. Provide the keywords as a JSON array **only**, without any additional text, labels, or explanations.
    
    Message: "${content}"
    
    Keywords:
    \`\`\`json
    [
      "keyword1",
      "keyword2",
      "keyword3",
      "keyword4",
      "keyword5"
    ]
    \`\`\`
    `;

    const filter = new Filter();

    // Comprehensive list of offensive terms and phrases
    const offensiveTerms = [
        "stfu",
        "nigger",
        "n1gger",
        "shit",
        "sh!t",
        "fucking",
        "fuck",
        "f@ck",
        "fucked",
        "bitch",
        "ass",
        "mfw",
        "junkie",
        "slut",
        "tits",
        "incel",
        "raped",
        "neo nazis",
        "whatever",
        // Add more offensive terms as needed
    ];

    // Add offensive terms to the bad-words filter
    offensiveTerms.forEach((term) => filter.addWords(term));

    // Offensive phrases
    const offensivePhrases = [
        "neo nazis",
        // Add more offensive phrases as needed
    ];

    try {
        console.log(`Processing Message: "${content}"`);

        const response = await openaiClient.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 60,
            temperature: 0.2, // Lowered for increased consistency
        });

        // Safely access the content using optional chaining
        const aiResponse = response.choices?.[0]?.message?.content?.trim();

        if (!aiResponse) {
            console.warn("AI response is empty or undefined.");
            return [];
        }

        // Log the raw AI response for debugging
        console.log(`AI Response:\n${aiResponse}`);

        // Extract JSON array from the code block
        const jsonRegex = /```json\s*\n([\s\S]*?)\n```/;
        const match = aiResponse.match(jsonRegex);
        let keywords: string[] = [];

        if (match && match[1]) {
            try {
                const parsed = JSON.parse(match[1]);
                if (Array.isArray(parsed)) {
                    keywords = parsed;
                    console.log(`Parsed JSON Keywords:`, keywords);
                }
            } catch (parseError) {
                console.warn("Failed to parse JSON within code block.");
            }
        }

        if (keywords.length === 0) {
            // Fallback to line-by-line parsing if JSON parsing fails
            console.warn(
                "No keywords extracted from JSON. Falling back to line-by-line parsing.",
            );
            keywords = aiResponse
                .split("\n")
                .map((line) => line.replace(/^-+\s*/, "").trim()) // Remove leading hyphens and whitespace
                .filter((word) => word.length > 0);
            console.log(`Line-by-Line Parsed Keywords:`, keywords);
        }

        // Filter out offensive terms using bad-words filter and offensive phrases
        keywords = keywords.filter((word) => {
            const cleanWord = word.toLowerCase().replace(/[^a-zA-Z0-9 ]/g, ""); // Remove punctuation and convert to lowercase

            // Check for offensive phrases first
            for (const phrase of offensivePhrases) {
                if (cleanWord.includes(phrase)) {
                    console.warn(`Excluded offensive phrase keyword: ${word}`);
                    return false;
                }
            }

            // Check for offensive words
            if (filter.isProfane(cleanWord)) {
                console.warn(`Excluded offensive keyword: ${word}`);
                return false;
            }

            return true;
        });

        // Additional Filtering for Unwanted Generic Keywords
        const unwantedKeywords = [
            "discord",
            "message",
            "top",
            "relevant",
            "keywords",
        ];
        keywords = keywords.filter((word) => {
            const cleanWord = word.toLowerCase();
            if (unwantedKeywords.includes(cleanWord)) {
                console.warn(`Excluded unwanted generic keyword: ${word}`);
                return false;
            }
            return true;
        });

        // Ensure uniqueness and reasonable length
        keywords = Array.from(new Set(keywords))
            .filter((word) => word.length >= 2 && word.length <= 50); // Adjust lengths as needed

        // Log the final extracted keywords
        console.log(`Final Extracted Keywords:`, keywords);

        return keywords;
    } catch (error) {
        console.error("Error extracting keywords with AI:", error);
        return [];
    }
}
