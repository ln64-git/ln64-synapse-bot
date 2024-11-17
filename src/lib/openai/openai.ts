import OpenAI from "openai";

export async function generateCypherQuery(question: string): Promise<string> {
  // Initialize OpenAI
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }

  const openai = new OpenAI({
    apiKey: openaiApiKey,
  });

  // Generate Cypher Query using OpenAI
  const prompt = `
You are an AI assistant that translates English questions into Cypher queries for a Neo4j database. The database contains nodes labeled User, Message, Channel, and Guild, with relationships such as SENT_MESSAGE, IN_CHANNEL, MENTIONS, HAS_MEMBER, etc.

Translate the following question into a Cypher query. Only provide the Cypher query and nothing else.

Question: "${question}"

Cypher Query:
`;

  const response = await openai.completions.create({
    model: "text-davinci-003",
    prompt,
    max_tokens: 100,
  });

  const cypherQuery = response.choices[0].text?.trim();
  if (!cypherQuery) {
    throw new Error("Failed to generate Cypher query.");
  }

  return cypherQuery;
}
