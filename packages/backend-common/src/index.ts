import dotenv from "dotenv";
import fs from "fs";
import path from "path";

export function repoRoot(start = process.cwd()) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
        if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    return start;
}

export function loadRepoEnv() {
    dotenv.config({ path: path.join(repoRoot(), ".env") });
}

loadRepoEnv();

export const JWT_SECRET = process.env.JWT_SECRET || "123456";
export const LIVEKIT_URL = process.env.LIVEKIT_URL || "";
export const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
export const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";
