import dotenv from "dotenv";
import fs from "fs";
import path from "path";

function repoRoot(start = process.cwd()) {
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
