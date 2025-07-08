/**
 * Example function to batch-call the OpenAI Embedding API.
 * Replace with your own or adjust as needed.
 */
export async function getEmbeddingBatch(
    texts: string[],
    retryCount = 0,
): Promise<(number[] | null)[]> {
    const validTexts = texts
        .map((text) => text.trim())
        .filter((text) => text && !/https?:\/\/\S+/.test(text));

    if (validTexts.length === 0) {
        return texts.map(() => null);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, 15000); // 15s

    try {
        const response = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                input: validTexts,
                model: "text-embedding-ada-002",
            }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errorData = await response.json();
            console.error(
                "Embedding API error:",
                response.statusText,
                errorData,
            );

            // Retry logic for 429 rate-limit
            if (response.status === 429 && retryCount < 5) {
                const waitTime = Math.pow(2, retryCount) * 1000;
                console.log(`Rate limit hit. Retrying in ${waitTime}ms...`);
                await new Promise((resolve) => setTimeout(resolve, waitTime));
                return await getEmbeddingBatch(texts, retryCount + 1);
            }

            return texts.map(() => null);
        }

        const data = await response.json();
        const embeddings = data.data.map((item: any) => item.embedding);

        const results: (number[] | null)[] = [];
        let embeddingIndex = 0;
        for (const text of texts) {
            if (text.trim() && !/https?:\/\/\S+/.test(text)) {
                results.push(embeddings[embeddingIndex++]);
            } else {
                results.push(null);
            }
        }

        return results;
    } catch (error) {
        clearTimeout(timeout);

        if ((error as Error).name === "AbortError") {
            console.error(
                "Request timed out for batch starting with text:",
                texts[0],
            );
        } else {
            console.error("Error fetching embeddings:", error);
        }
        return texts.map(() => null);
    }
}
