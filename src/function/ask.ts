import { executeCypherQuery } from "../lib/neo4j/neo4j";
import {
    generateCypherQuery,
    generateNaturalLanguageResponse,
} from "../lib/langchain/langchain";

export async function ask(question: string): Promise<string> {
    // Step 1: Process question from user
    // This includes breaking down the question and identifying the necessary tools and data required to accurately execute the user's query
    const cypherQuery = await generateCypherQuery(question);
    console.log(`Generated Cypher Query: ${cypherQuery}`);

    // Step 2: Assimulate the necessary data
    // This includes using the response from Step 1 to accurately query the database to retrieve the data necessary needed for the user's query
    const records = await executeCypherQuery(cypherQuery);
    console.log(`Query Records: ${JSON.stringify(records, null, 2)}`);

    // Step 3: Assimulate the final response prompt
    // This will take the user's query and the data retrieved from the database to provide a detailed response to the user's query
    const response = await generateNaturalLanguageResponse(records);
    console.log(`Generated Response: ${response}`);

    return response;
}
