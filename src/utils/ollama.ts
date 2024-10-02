import axios from 'axios';

export async function analyzeSentimentWithOllama(text: string): Promise<string> {
    try {
        const prompt = `You are an AI language model that analyzes the sentiment of user messages.

        Given the following text, provide a detailed sentiment analysis, highlighting key themes and emotions.
        
        **Your analysis should be no more than 1800 characters.**
        
        Text:
        ${text}
        
        Provide your analysis below:
        
        `;
        
        const response = await axios.post(
            'http://localhost:11434/api/generate',
            {
                model: 'llama3.1', // Updated model name
                prompt: prompt,
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
                console.log(generatedText)
            }
        }

        return generatedText.trim();
    } catch (error) {
        console.error('Error communicating with Ollama API:', error);
        throw new Error('Failed to analyze sentiment using Ollama.');
    }
}
