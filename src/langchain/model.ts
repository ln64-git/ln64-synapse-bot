import { Ollama } from "@langchain/ollama";

export async function callModel(
    // model: string,
    prompt: string,
    options: Record<string, string> = {},
): Promise<string> {
    try {
        return await ollama._call(prompt, { ...options });
    } catch (error: unknown) {
        if (error instanceof Error) {
            throw new Error(`Failed to call model: ${error.message}`);
        } else {
            throw new Error('Failed to call model: Unknown error');
        }
    }
}

export const ollama = new Ollama({
    baseUrl: "http://localhost:11434",
    model: "llama3.1",
});
