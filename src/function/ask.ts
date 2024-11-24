import {
    generateCypherQuery,
    generateNaturalLanguageResponse,
} from "../lib/langchain/langchain";
import { executeCypherQuery } from "../lib/neo4j/neo4j";

export async function ask(question: string): Promise<string> {
    try {
        console.log(`Received question: "${question}"`);

        const cypherQuery = await generateCypherQuery(question);
        console.log(`Generated Cypher Query: ${cypherQuery}`);

        const records = await executeCypherQuery(cypherQuery);
        if (!records || records.length === 0) {
            console.warn(
                "Query returned no results. Ensure the database contains relevant data.",
            );
            return "No results found for your query.";
        }

        const topUser = records[0]["userName"] || "Unknown User";
        const response = `The person with the most messages is: ${topUser}.`;
        console.log(`Generated Response: ${response}`);

        return response;
    } catch (error) {
        console.error("Error in ask function:", error);
        return "An error occurred while processing your query. Please try again.";
    }
}
