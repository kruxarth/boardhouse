import { randomUUID } from "crypto";
import type { WebSocket } from "ws";
import type { AccessMode, ReplayEvent } from "@repo/common/types";
import {
    ASK_COOLDOWN_MS,
    ASK_WINDOW_MS,
    AVATAR_COUNT,
    HOLDER_IDLE_MS,
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
    avatar: number;
    /** Last stroke or cursor move, used to decide whether a holder has wandered off. */
    activeAt: number;
    reactedAt: number;
};

export type MarkerAsk = {
    requestId: string;
    fromParticipantId: string;
    holderId: string;
    slot: 0 | 1;
    expiresAt: number;
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
    /** `${participantId}:${slot}` -> timestamp they may ask that slot again. */
    askCooldowns: Map<string, number>;
    avatarOrder: number[];
    avatars: Map<string, number>;
    canvas: unknown;
    replay: ReplayEvent[];
    replayBytes: number;
};

function shuffled(count: number) {
    const order = Array.from({ length: count }, (_, index) => index);
    for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
    }
    return order;
}

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
        askCooldowns: new Map(),
        avatarOrder: shuffled(AVATAR_COUNT),
        avatars: new Map(),
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
    const dropped: MarkerAsk[] = [];
    for (const [id, ask] of room.asks) {
        if (ask.fromParticipantId === participantId || ask.holderId === participantId) {
            room.asks.delete(id);
            dropped.push(ask);
        }
    }
    return { changed, dropped };
}

export function holdsMarker(room: LiveRoom, participantId: string) {
    return room.markers[0] === participantId || room.markers[1] === participantId;
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
        expiresAt: Date.now() + ASK_WINDOW_MS,
    };
}

export function pendingAskFrom(room: LiveRoom, fromParticipantId: string) {
    for (const ask of room.asks.values()) {
        if (ask.fromParticipantId === fromParticipantId) {
            return ask;
        }
    }
    return null;
}

function cooldownKey(participantId: string, slot: 0 | 1) {
    return `${participantId}:${slot}`;
}

export function cooldownLeft(room: LiveRoom, participantId: string, slot: 0 | 1) {
    const until = room.askCooldowns.get(cooldownKey(participantId, slot));
    if (!until) {
        return 0;
    }
    return Math.max(0, until - Date.now());
}

export function startCooldown(room: LiveRoom, participantId: string, slot: 0 | 1) {
    room.askCooldowns.set(cooldownKey(participantId, slot), Date.now() + ASK_COOLDOWN_MS);
}

export function lapsedAsks(room: LiveRoom) {
    const now = Date.now();
    return [...room.asks.values()].filter((ask) => ask.expiresAt <= now);
}

/** A holder who has not drawn or moved in a while hands the marker over without being nudged. */
export function holderIsAway(room: LiveRoom, holderId: string) {
    const holder = room.admitted.get(holderId);
    if (!holder) {
        return true;
    }
    return Date.now() - holder.activeAt >= HOLDER_IDLE_MS;
}

export function assignAvatar(room: LiveRoom, participantId: string) {
    const taken = new Set<number>();
    for (const seat of [...room.admitted.values(), ...room.waiting.values()]) {
        if (seat.participantId !== participantId) {
            taken.add(seat.avatar);
        }
    }
    const remembered = room.avatars.get(participantId);
    if (remembered !== undefined && !taken.has(remembered)) {
        return remembered;
    }
    for (const index of room.avatarOrder) {
        if (!taken.has(index)) {
            room.avatars.set(participantId, index);
            return index;
        }
    }
    return room.avatarOrder[0] ?? 0;
}

export function clearAsksForSlot(room: LiveRoom, slot: 0 | 1) {
    const cleared: MarkerAsk[] = [];
    for (const [id, ask] of room.asks) {
        if (ask.slot === slot) {
            room.asks.delete(id);
            cleared.push(ask);
        }
    }
    return cleared;
}

/**
 * The slot changed hands. Whoever asked for it is now asking the new holder, except
 * the new holder themselves, whose ask just came true.
 */
export function retargetAsks(room: LiveRoom, slot: 0 | 1, holderId: string) {
    const answered: MarkerAsk[] = [];
    for (const [id, ask] of room.asks) {
        if (ask.slot !== slot) {
            continue;
        }
        if (ask.fromParticipantId === holderId) {
            room.asks.delete(id);
            answered.push(ask);
            continue;
        }
        ask.holderId = holderId;
        ask.expiresAt = Date.now() + ASK_WINDOW_MS;
    }
    return answered;
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
