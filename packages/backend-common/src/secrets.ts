import { loadRepoEnv } from "./env";

loadRepoEnv();

const DEV_JWT_SECRET = "123456";

function jwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (secret) {
        return secret;
    }
    if (process.env.NODE_ENV === "production") {
        throw new Error("JWT_SECRET is required when NODE_ENV is production");
    }
    return DEV_JWT_SECRET;
}

export const JWT_SECRET = jwtSecret();
export const LIVEKIT_URL = process.env.LIVEKIT_URL || "";
export const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
export const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";
