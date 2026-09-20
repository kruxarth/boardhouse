import axios from "axios";
import { BACKEND_URL } from "../app/config";
import { clearSession, writeSession, type Session } from "./session";

export type Occupancy = {
    used: number;
    max: number;
    tables: HouseTable[];
};

export type HouseTable =
    | { empty: true }
    | { empty: false; slug: string; name: string | null; hostName: string; expiresAt: string };

export type CreatedRoom = {
    slug: string;
    hostKey: string;
    name: string | null;
    accessMode: "knock" | "open";
    expiresAt: string;
    guestPath: string;
    hostPath: string;
    occupancy: Occupancy;
};

export type RoomMeta = {
    slug: string;
    requestedSlug: string;
    viaFormerSlug: boolean;
    name: string | null;
    accessMode: "knock" | "open";
    expiresAt: string;
    hostParticipantId: string;
};

export function isUnauthorizedError(error: unknown) {
    return axios.isAxiosError(error) && error.response?.status === 401;
}

export async function createSession(name: string): Promise<Session> {
    const response = await axios.post<Session>(`${BACKEND_URL}/session`, { name });
    writeSession(response.data);
    return response.data;
}

export async function refreshSession(token: string): Promise<Session> {
    const response = await axios.post<Session>(
        `${BACKEND_URL}/session/refresh`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
    );
    writeSession(response.data);
    return response.data;
}

export async function sessionForSitting(existing: Session | null, name?: string): Promise<Session> {
    if (existing) {
        try {
            return await refreshSession(existing.token);
        } catch (error) {
            if (isUnauthorizedError(error)) {
                clearSession();
            } else {
                return existing;
            }
        }
    }
    if (!name) {
        throw new Error("Name required");
    }
    return createSession(name);
}

export async function fetchOccupancy() {
    const response = await axios.get<Occupancy>(`${BACKEND_URL}/occupancy`);
    return response.data;
}

export async function createRoom(token: string, name: string) {
    try {
        const response = await axios.post<CreatedRoom>(
            `${BACKEND_URL}/rooms`,
            { name },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
            clearSession();
            throw new Error("Name required");
        }
        if (axios.isAxiosError(error) && error.response?.status === 503) {
            const occupancy = error.response.data?.occupancy as Occupancy | undefined;
            const err = new Error("House is full") as Error & { occupancy?: Occupancy };
            err.occupancy = occupancy;
            throw err;
        }
        throw new Error("Could not open a table");
    }
}

export async function fetchRoom(slug: string) {
    try {
        const response = await axios.get<RoomMeta>(`${BACKEND_URL}/rooms/${slug}`);
        return { ok: true as const, room: response.data };
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
            return { ok: false as const, status: "missing" as const };
        }
        if (axios.isAxiosError(error) && error.response?.status === 410) {
            return { ok: false as const, status: "expired" as const };
        }
        return { ok: false as const, status: "error" as const };
    }
}

export async function fetchLivekitToken(token: string, slug: string) {
    try {
        const response = await axios.get<{
            configured: boolean;
            token: string;
            url: string;
        }>(`${BACKEND_URL}/livekit-token`, {
            params: { room: slug },
            headers: { Authorization: `Bearer ${token}` },
        });
        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 503) {
            return { configured: false as const, token: "", url: "" };
        }
        throw error;
    }
}
