export type Session = {
    token: string;
    participantId: string;
    name: string;
};

const TOKEN_KEY = "board-house.token";
const ID_KEY = "board-house.participantId";
const NAME_KEY = "board-house.name";

function readKey(key: string, legacy: string) {
    return localStorage.getItem(key) ?? localStorage.getItem(legacy);
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
