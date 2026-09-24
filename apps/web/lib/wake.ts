import { WS_BACKEND_URL } from "../app/config";

// Render's free tier sleeps idle services, and waking one can take a minute or more.
export const WAKE_BUDGET_MS = 180_000;

/** Any plain request starts a sleeping service; the reply doesn't matter. */
export function nudgeTableLine() {
    const url = WS_BACKEND_URL.replace(/^ws/, "http");
    void fetch(url, { mode: "no-cors", cache: "no-store" }).catch(() => undefined);
}

export function elapsedLabel(ms: number) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}
