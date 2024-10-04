// src/utils/agent-utils.ts

import { Ollama } from '@langchain/ollama';

// Initialize the Ollama language model
const model = new Ollama({
    baseUrl: 'http://localhost:11434',
    model: 'llama3.1',
});

export async function analyzeSentimentWithAgent(text: string): Promise<string> {
    const MAX_TEXT_LENGTH = 4000; // Adjust as needed based on model limits
    if (text.length > MAX_TEXT_LENGTH) {
        text = text.slice(0, MAX_TEXT_LENGTH);
    }

    const prompt = `You are an AI assistant helping to provide an overview of a user's recent conversations in an accessible and conversational manner.

**Instructions:**
- Summarize the user's interactions in an direct way.
- Emphasize key topics, interests, and communication habits.
- Write as if you're sharing interesting observations with someone curious about the user.
- Maintain a casual tone without being overly formal.
- !!IMPORTANT!! Response should be equal to or under 2000.

Conversation Logs:
${text}

Please share the summary below:
`;

    try {
        const response = await model.invoke(prompt);
        const rawResponse = response.trim();

        // Ensure the response does not exceed the character limit
        const MAX_RESPONSE_LENGTH = 1800;
        const finalResponse =
            rawResponse.length > MAX_RESPONSE_LENGTH
                ? rawResponse.slice(0, MAX_RESPONSE_LENGTH) + '...'
                : rawResponse;

        return finalResponse;
    } catch (error) {
        console.error('Error during sentiment analysis:', error);
        throw new Error('Failed to analyze sentiment.');
    }
}

export async function generateSummaryWithAgent(prompt: string): Promise<string> {
    const MAX_RESPONSE_LENGTH = 200; // Adjust as needed

    try {
        const response = await model.invoke(prompt);
        const rawResponse = response.trim();
        // Ensure the response does not exceed the character limit
        const finalResponse =
            rawResponse.length > MAX_RESPONSE_LENGTH
                ? rawResponse.slice(0, MAX_RESPONSE_LENGTH) + '...'
                : rawResponse;
        return finalResponse;
    } catch (error) {
        console.error('Error generating summary with agent:', error);
        throw new Error('Failed to generate summary using agent.');
    }
}