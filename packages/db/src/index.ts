import "./env";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
}

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 20_000,
});
const adapter = new PrismaPg(pool);

export const prismaClient = new PrismaClient({ adapter });
