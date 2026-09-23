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

/** Load the repo-root `.env` without overriding variables that are already set. */
export function loadRepoEnv() {
    const envPath = path.join(repoRoot(), ".env");
    if (!fs.existsSync(envPath)) {
        return;
    }
    for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) {
            continue;
        }
        const eq = line.indexOf("=");
        if (eq === -1) {
            continue;
        }
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}
