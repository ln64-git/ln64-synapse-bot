import { Ollama } from '@langchain/ollama';

// Initialize the Ollama language model
const model = new Ollama({
    baseUrl: 'http://localhost:11434',
    model: 'llama3.1',
    // model: 'llama2-uncensored',
});

export async function analyzeSentimentWithAgent(text: string): Promise<string> {
    const MAX_TEXT_LENGTH = 4000; // Limit the text length
    if (text.length > MAX_TEXT_LENGTH) {
        text = text.slice(0, MAX_TEXT_LENGTH);
    }
// Scathing Criteque
    const prompt = `You are an AI language model that analyzes the sentiment of a user in a discord, you are given a list of associates and conversations relating to a given user.

Given the following conversation, provide a detailed sentiment analysis, highlighting key themes and emotions.

**Your analysis should be no more than 1800 characters.**

Conversation:
${text}

Provide your analysis below:
`;

    try {
        const response = await model.invoke(prompt);
        const rawResponse = response.trim();

        // Limit the response length
        const MAX_RESPONSE_LENGTH = 1800;
        return rawResponse.length > MAX_RESPONSE_LENGTH
            ? rawResponse.slice(0, MAX_RESPONSE_LENGTH) + '...'
            : rawResponse;

    } catch (error) {
        console.error('Error during sentiment analysis:', error);
        throw new Error('Failed to analyze sentiment.');
    }
}

export async function generateSummaryWithAgent(prompt: string): Promise<string> {
    const MAX_RESPONSE_LENGTH = 200;

    try {
        const response = await model.invoke(prompt);
        const rawResponse = response.trim();
        return rawResponse.length > MAX_RESPONSE_LENGTH
            ? rawResponse.slice(0, MAX_RESPONSE_LENGTH) + '...'
            : rawResponse;
    } catch (error) {
        console.error('Error generating summary with agent:', error);
        throw new Error('Failed to generate summary.');
    }
}
