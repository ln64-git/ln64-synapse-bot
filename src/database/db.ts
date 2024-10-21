import { Client } from "pg";
import { env } from "process";

const client = new Client({
    user: env.DB_USER,
    host: env.DB_HOST,
    database: "discord",
    password: "discord",
    port: 5432,
});

export async function connectToDatabase() {
    try {
        await client.connect();
        console.log("Connected to the database");
    } catch (err) {
        console.error("Error connecting to the database:", err);
        throw err;
    }
}

