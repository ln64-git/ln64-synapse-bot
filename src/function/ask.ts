// This function is executed by a discord bot command for users to make natural language queries to their Discord Guild data
export function ask(question: string) {
    // Step 1: Process question from user
    // This includes breaking down the question and identifying the necessary tools and data required to accurately execute the user's query

    // Step 2: Assimulate the necessary data
    // This includes using the response from Step 1 to accuratelly query the database to retrieve the data necessary needed for the user's query

    // Step 3: Assimulate the final response prompt
    // This will take the user's query and the data retrieved from the database to provide a detailed response to the user's query  

    const data: any[] = [];

    const responsePrompt: string = `
        You are a personal assistant used to provide a detailed question => answer response
        The data you will be querying is a database of users and their associated conversations
        Here are the tools at your disposal:
        generateConversations - generates a conversation between two users
        `;
}
