import { ROOM_TTL_MS } from "@repo/common/constants";

export type Session = {
    token: string;
    participantId: string;
    name: string;
};

const TOKEN_KEY = "board-house.token";
const ID_KEY = "board-house.participantId";
const NAME_KEY = "board-house.name";
const SKEW_MS = 5_000;

function readKey(key: string, legacy: string) {
    return localStorage.getItem(key) ?? localStorage.getItem(legacy);
}

function decodeJwtPayload(token: string): { exp?: unknown; iat?: unknown } | null {
    const payload = token.split(".")[1];
    if (!payload) {
        return null;
    }
    try {
        const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
        const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
        return JSON.parse(atob(padded + pad)) as { exp?: unknown; iat?: unknown };
    } catch {
        return null;
    }
}

export function sessionStillValid(token: string, at = Date.now()): boolean {
    const payload = decodeJwtPayload(token);
    if (!payload) {
        return false;
    }
    const deadline = at + SKEW_MS;
    if (typeof payload.exp === "number" && payload.exp * 1000 <= deadline) {
        return false;
    }
    if (typeof payload.iat === "number" && payload.iat * 1000 + ROOM_TTL_MS <= deadline) {
        return false;
    }
    if (typeof payload.exp !== "number" && typeof payload.iat !== "number") {
        return false;
    }
    return true;
}

export function readSession(): Session | null {
    if (typeof window === "undefined") {
        return null;
    }
    const token = readKey(TOKEN_KEY, "boardhouse.token");
    const participantId = readKey(ID_KEY, "boardhouse.participantId");
    const name = readKey(NAME_KEY, "boardhouse.name");
    if (!token || !participantId || !name) {
        return null;
    }
    if (!sessionStillValid(token)) {
        clearSession();
        return null;
    }
    return { token, participantId, name };
}

export function writeSession(session: Session) {
    localStorage.setItem(TOKEN_KEY, session.token);
    localStorage.setItem(ID_KEY, session.participantId);
    localStorage.setItem(NAME_KEY, session.name);
}

export function clearSession() {
    if (typeof window === "undefined") {
        return;
    }
    for (const key of [
        TOKEN_KEY,
        ID_KEY,
        NAME_KEY,
        "boardhouse.token",
        "boardhouse.participantId",
        "boardhouse.name",
    ]) {
        localStorage.removeItem(key);
    }
}

export function hostStorageKey(slug: string) {
    return `board-house.hostKey.${slug}`;
}

export function rememberHostKey(slug: string, hostKey: string) {
    sessionStorage.setItem(hostStorageKey(slug), hostKey);
}

export function readHostKey(slug: string) {
    return (
        sessionStorage.getItem(hostStorageKey(slug)) ??
        sessionStorage.getItem(`boardhouse.hostKey.${slug}`)
    );
}
