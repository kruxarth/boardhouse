import { randomUUID } from "crypto";
import type { WebSocket } from "ws";
import type { AccessMode, ReplayEvent } from "@repo/common/types";
import {
    MAX_REPLAY_BYTES,
    MAX_REPLAY_EVENTS,
    MIN_REPLAY_CANVAS_GAP_MS,
    MAX_SEATS,
} from "@repo/common/constants";

export type Seat = {
    ws: WebSocket;
    participantId: string;
    name: string;
    muted: boolean;
    admitted: boolean;
};

export type MarkerAsk = {
    requestId: string;
    fromParticipantId: string;
    holderId: string;
    slot: 0 | 1;
};

export type LiveRoom = {
    id: string;
    slug: string;
    formerSlugs: Set<string>;
    hostKey: string;
    hostParticipantId: string;
    accessMode: AccessMode;
    name: string | null;
    expiresAt: number;
    startedAt: number;
    admitted: Map<string, Seat>;
    waiting: Map<string, Seat>;
    markers: [string | null, string | null];
    asks: Map<string, MarkerAsk>;
    canvas: unknown;
    replay: ReplayEvent[];
    replayBytes: number;
};

export const liveRooms = new Map<string, LiveRoom>();

export function createLiveRoom(row: {
    id: string;
    slug: string;
    formerSlugs: string[];
    hostKey: string;
    hostParticipantId: string;
    accessMode: string;
    name: string | null;
    createdAt: Date;
    expiresAt: Date;
}): LiveRoom {
    const room: LiveRoom = {
        id: row.id,
        slug: row.slug,
        formerSlugs: new Set(row.formerSlugs),
        hostKey: row.hostKey,
        hostParticipantId: row.hostParticipantId,
        accessMode: row.accessMode === "open" ? "open" : "knock",
        name: row.name,
        expiresAt: row.expiresAt.getTime(),
        startedAt: row.createdAt.getTime(),
        admitted: new Map(),
        waiting: new Map(),
        markers: [row.hostParticipantId, null],
        asks: new Map(),
        canvas: { elements: [], files: {} },
        replay: [],
        replayBytes: 0,
    };
    appendReplay(room, "canvas", room.canvas);
    return room;
}

export function exportReplay(room: LiveRoom) {
    const events = room.replay.slice();
    if (room.canvas) {
        const last = events[events.length - 1];
        if (!(last?.type === "canvas" && last.payload === room.canvas)) {
            events.push({
                t: Math.max(0, Date.now() - room.startedAt),
                type: "canvas",
                payload: room.canvas,
            });
        }
    }
    return {
        type: "replay" as const,
        version: 1,
        startedAt: new Date(room.startedAt).toISOString(),
        slug: room.slug,
        events,
    };
}

export function getLiveRoom(id: string) {
    return liveRooms.get(id);
}

export function rememberLiveRoom(room: LiveRoom) {
    liveRooms.set(room.id, room);
}

export function forgetLiveRoom(id: string) {
    liveRooms.delete(id);
}

function replayEventSize(event: ReplayEvent) {
    try {
        return JSON.stringify(event).length;
    } catch {
        return 0;
    }
}

function dropDensestReplay(room: LiveRoom) {
    if (room.replay.length <= 2) {
        const removed = room.replay.shift();
        if (removed) {
            room.replayBytes -= replayEventSize(removed);
        }
        return;
    }
    let dropAt = 1;
    let tightest = Infinity;
    for (let i = 1; i < room.replay.length - 1; i += 1) {
        const prev = room.replay[i - 1]!;
        const current = room.replay[i]!;
        const next = room.replay[i + 1]!;
        const densest = Math.min(current.t - prev.t, next.t - current.t);
        if (densest < tightest) {
            tightest = densest;
            dropAt = i;
        }
    }
    const removed = room.replay.splice(dropAt, 1)[0];
    if (removed) {
        room.replayBytes -= replayEventSize(removed);
    }
}

function trimReplay(room: LiveRoom) {
    while (
        room.replay.length > MAX_REPLAY_EVENTS ||
        room.replayBytes > MAX_REPLAY_BYTES
    ) {
        if (room.replay.length === 0) {
            room.replayBytes = 0;
            break;
        }
        dropDensestReplay(room);
    }
    if (room.replayBytes < 0) {
        room.replayBytes = 0;
    }
}

export function appendReplay(room: LiveRoom, type: string, payload: unknown) {
    const t = Date.now() - room.startedAt;
    if (type === "canvas") {
        const last = room.replay[room.replay.length - 1];
        if (last?.type === "canvas" && t - last.t < MIN_REPLAY_CANVAS_GAP_MS) {
            room.replayBytes -= replayEventSize(last);
            last.t = t;
            last.payload = payload;
            room.replayBytes += replayEventSize(last);
            trimReplay(room);
            return;
        }
    }
    const event: ReplayEvent = { t, type, payload };
    room.replay.push(event);
    room.replayBytes += replayEventSize(event);
    trimReplay(room);
}

export function dropMarkersHeldBy(room: LiveRoom, participantId: string) {
    let changed = false;
    if (room.markers[0] === participantId) {
        room.markers[0] = null;
        changed = true;
    }
    if (room.markers[1] === participantId) {
        room.markers[1] = null;
        changed = true;
    }
    for (const [id, ask] of room.asks) {
        if (ask.fromParticipantId === participantId || ask.holderId === participantId) {
            room.asks.delete(id);
        }
    }
    return changed;
}

export function holdsMarker(room: LiveRoom, participantId: string) {
    return room.markers[0] === participantId || room.markers[1] === participantId;
}

export function slotHeldBy(room: LiveRoom, participantId: string): 0 | 1 | null {
    if (room.markers[0] === participantId) {
        return 0;
    }
    if (room.markers[1] === participantId) {
        return 1;
    }
    return null;
}

export function newAsk(
    fromParticipantId: string,
    holderId: string,
    slot: 0 | 1
): MarkerAsk {
    return {
        requestId: randomUUID(),
        fromParticipantId,
        holderId,
        slot,
    };
}

export function existingAsk(room: LiveRoom, fromParticipantId: string, holderId: string) {
    for (const ask of room.asks.values()) {
        if (ask.fromParticipantId === fromParticipantId && ask.holderId === holderId) {
            return ask;
        }
    }
    return null;
}

export function clearAsksForSlot(room: LiveRoom, slot: 0 | 1) {
    for (const [id, ask] of room.asks) {
        if (ask.slot === slot) {
            room.asks.delete(id);
        }
    }
}

export function retargetAsks(room: LiveRoom, slot: 0 | 1, holderId: string) {
    for (const [id, ask] of room.asks) {
        if (ask.slot !== slot) {
            continue;
        }
        if (ask.fromParticipantId === holderId) {
            room.asks.delete(id);
            continue;
        }
        ask.holderId = holderId;
    }
}

export function asksHeldBy(room: LiveRoom, holderId: string) {
    return [...room.asks.values()].filter((ask) => ask.holderId === holderId);
}

export function isExpired(room: LiveRoom) {
    return room.expiresAt <= Date.now();
}

export function guestSeatOpen(room: LiveRoom) {
    const hostHere = room.admitted.has(room.hostParticipantId);
    const reserved = hostHere ? 0 : 1;
    return room.admitted.size + reserved < MAX_SEATS;
}

export function hostSeatOpen(room: LiveRoom) {
    return room.admitted.size < MAX_SEATS || room.admitted.has(room.hostParticipantId);
}
