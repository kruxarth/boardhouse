import { randomUUID } from "crypto";
import type { WebSocket } from "ws";
import type { AccessMode, ReplayEvent } from "@repo/common/types";
import { MAX_REPLAY_BYTES, MAX_REPLAY_EVENTS, MAX_SEATS } from "@repo/common/constants";

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
    return {
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
        canvas: null,
        replay: [],
        replayBytes: 0,
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

export function appendReplay(room: LiveRoom, type: string, payload: unknown) {
    const event: ReplayEvent = { t: Date.now() - room.startedAt, type, payload };
    const size = JSON.stringify(event).length;
    room.replay.push(event);
    room.replayBytes += size;

    while (
        room.replay.length > MAX_REPLAY_EVENTS ||
        room.replayBytes > MAX_REPLAY_BYTES
    ) {
        const removed = room.replay.shift();
        if (!removed) {
            break;
        }
        room.replayBytes -= JSON.stringify(removed).length;
        if (room.replayBytes < 0) {
            room.replayBytes = 0;
        }
    }
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
