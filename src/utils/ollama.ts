// src/utils/ollama.ts

import axios from 'axios';
import { MessageData } from '../types';

export async function queryOllamaAPI(
    prompt: string,
    model: string,
    maxTokens: number
): Promise<string> {
    try {
        const response = await axios.post(
            'http://localhost:11434/api/generate',
            {
                model: model,
                prompt: prompt,
                max_tokens: maxTokens,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                responseType: 'stream',
            }
        );

        let generatedText = '';
        for await (const chunk of response.data) {
            const lines = chunk.toString('utf8').split('\n');
            for (const line of lines) {
                if (line.trim() === '') continue;
                const data = JSON.parse(line);
                if (data.done) break;
                generatedText += data.response;
            }
        }

        return generatedText.trim();
    } catch (error) {
        console.error('Error communicating with Ollama API:', error);
        throw new Error('Failed to communicate with Ollama API.');
    }
}

export async function analyzeSentimentWithOllama(text: string): Promise<string> {
    const prompt = `You are an AI language model that analyzes the sentiment of user messages.

Given the following conversation, provide a detailed sentiment analysis, highlighting key themes and emotions.

**Your analysis should be no more than 1800 characters.**

Conversation:
${text}

Provide your analysis below:
`;

    const maxTokens = 500; // Adjust as needed
    const model = 'llama3.1';

    try {
        const generatedText = await queryOllamaAPI(prompt, model, maxTokens);
        // Enforce character limit if necessary
        return generatedText.length > 1800 ? generatedText.substring(0, 1800).trim() : generatedText.trim();
    } catch (error) {
        console.error('Error analyzing sentiment with Ollama:', error);
        throw new Error('Failed to analyze sentiment using Ollama.');
    }
}

export async function generateSummaryWithOllama(prompt: string): Promise<string> {
    const maxTokens = 50; // Adjust as needed
    const model = 'llama3.1';

    try {
        const generatedText = await queryOllamaAPI(prompt, model, maxTokens);
        // Enforce character limit if necessary
        return generatedText.length > 200 ? generatedText.substring(0, 200).trim() : generatedText.trim();
    } catch (error) {
        console.error('Error generating summary with Ollama:', error);
        throw new Error('Failed to generate summary using Ollama.');
    }
}

export interface ConversationBoundary {
    startTime: string; // ISO string
    endTime: string;   // ISO string
}

export async function detectConversationsWithOllama(timestamps: string[]): Promise<ConversationBoundary[]> {
    const prompt = `You are an AI language model that segments a series of message timestamps into conversations based on frequency and duration between messages.

Given the following list of message timestamps in ISO 8601 format, identify the start and end times of each conversation. A new conversation starts if there is a gap of more than 5 minutes between messages.

Timestamps:
${timestamps.join('\n')}

Provide the result as a JSON array of objects with "startTime" and "endTime" fields in ISO 8601 format.

Response (JSON array):`;

    const maxTokens = 500; // Adjust as needed
    const model = 'llama3.1';

    try {
        const generatedText = await queryOllamaAPI(prompt, model, maxTokens);
        // Parse the generated JSON array
        const conversations: ConversationBoundary[] = JSON.parse(generatedText);
        return conversations;
    } catch (error) {
        console.error('Error detecting conversations with Ollama:', error);
        throw new Error('Failed to detect conversations using Ollama.');
    }
}

export async function generateTitleForConversation(messages: MessageData[]): Promise<string> {
    const convText = messages
        .map((msg) => `${msg.authorUsername}: ${msg.content}`)
        .join('\n');

    const prompt = `You are an AI language model that generates concise titles for conversations.

Given the following conversation, provide a short title that summarizes the main topic.

Conversation:
${convText}

Title:`;

    try {
        const title = await generateSummaryWithOllama(prompt);
        return title.trim();
    } catch (error) {
        console.error('Error generating title for conversation:', error);
        throw new Error('Failed to generate title using Ollama.');
    }
}
