import { randomUUID } from "crypto";
import type { WebSocket } from "ws";
import type { AccessMode, ReplayEvent } from "@repo/common/types";
import {
    ASK_COOLDOWN_MS,
    ASK_WINDOW_MS,
    AVATAR_COUNT,
    HOLDER_IDLE_MS,
    MARKER_GRACE_MS,
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
    replayedAt: number;
    /** Last time this waiting seat knocked, so the door cannot be hammered. */
    lastKnockAt: number;
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
    /** When the last admitted person left. Null while someone is seated. */
    emptySince: number | null;
    admitted: Map<string, Seat>;
    waiting: Map<string, Seat>;
    markers: [string | null, string | null];
    asks: Map<string, MarkerAsk>;
    /** `${participantId}:${slot}` -> timestamp they may ask that slot again. */
    askCooldowns: Map<string, number>;
    avatarOrder: number[];
    avatars: Map<string, number>;
    canvas: CanvasScene;
    /** Set when the in-memory scene changes and still needs a database write. */
    canvasDirty: boolean;
    replay: ReplayEvent[];
    replayBytes: number;
    /** Disconnects that still own a marker until the grace timer fires. */
    markerGrace: Map<string, ReturnType<typeof setTimeout>>;
    /** Last seated count written to the database. -1 means it still needs a write. */
    seatedPersisted: number;
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

export type CanvasScene = {
    elements: unknown[];
    files: Record<string, unknown>;
};

export function asCanvasScene(value: unknown): CanvasScene {
    if (Array.isArray(value)) {
        return { elements: value, files: {} };
    }
    if (!value || typeof value !== "object") {
        return { elements: [], files: {} };
    }
    const record = value as { elements?: unknown; files?: unknown };
    const files =
        record.files && typeof record.files === "object" && !Array.isArray(record.files)
            ? (record.files as Record<string, unknown>)
            : {};
    return {
        elements: Array.isArray(record.elements) ? record.elements : [],
        files,
    };
}

function elementVersion(element: unknown) {
    if (!element || typeof element !== "object") {
        return null;
    }
    const record = element as { id?: unknown; version?: unknown; index?: unknown };
    if (typeof record.id !== "string" || record.id.length === 0) {
        return null;
    }
    return {
        id: record.id,
        version: typeof record.version === "number" ? record.version : 0,
        index: typeof record.index === "string" ? record.index : null,
    };
}

/**
 * Keep, for each element id, the copy with the highest version.
 * Order follows Excalidraw's fractional index when both sides have one.
 */
export function mergeElements(base: unknown[], incoming: unknown[]) {
    const byId = new Map<
        string,
        { element: unknown; version: number; index: string | null; order: number }
    >();
    let order = 0;
    const take = (list: unknown[]) => {
        for (const element of list) {
            const read = elementVersion(element);
            if (!read) {
                continue;
            }
            const prev = byId.get(read.id);
            if (!prev) {
                byId.set(read.id, {
                    element,
                    version: read.version,
                    index: read.index,
                    order: order++,
                });
                continue;
            }
            if (read.version > prev.version) {
                byId.set(read.id, {
                    element,
                    version: read.version,
                    index: read.index ?? prev.index,
                    order: prev.order,
                });
            } else if (prev.index === null && read.index) {
                prev.index = read.index;
            }
        }
    };
    take(base);
    take(incoming);
    return [...byId.values()]
        .sort((a, b) => {
            if (a.index && b.index && a.index !== b.index) {
                return a.index < b.index ? -1 : 1;
            }
            if (a.index && !b.index) {
                return -1;
            }
            if (!a.index && b.index) {
                return 1;
            }
            return a.order - b.order;
        })
        .map((entry) => entry.element);
}

export function mergeCanvas(current: unknown, incoming: unknown): CanvasScene {
    const base = asCanvasScene(current);
    const next = asCanvasScene(incoming);
    return {
        elements: mergeElements(base.elements, next.elements),
        files: { ...base.files, ...next.files },
    };
}

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
    emptySince?: Date | null;
    canvas?: unknown;
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
        emptySince: row.emptySince ? row.emptySince.getTime() : Date.now(),
        admitted: new Map(),
        waiting: new Map(),
        markers: [row.hostParticipantId, null],
        asks: new Map(),
        askCooldowns: new Map(),
        avatarOrder: shuffled(AVATAR_COUNT),
        avatars: new Map(),
        canvas: asCanvasScene(row.canvas),
        canvasDirty: false,
        replay: [],
        replayBytes: 0,
        markerGrace: new Map(),
        seatedPersisted: -1,
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

export function clearMarkerGrace(room: LiveRoom, participantId?: string) {
    if (!participantId) {
        for (const timer of room.markerGrace.values()) {
            clearTimeout(timer);
        }
        room.markerGrace.clear();
        return;
    }
    const timer = room.markerGrace.get(participantId);
    if (timer) {
        clearTimeout(timer);
    }
    room.markerGrace.delete(participantId);
}

/** Hold a leaver's markers until `release` runs, so a refresh can sit back down. */
export function armMarkerGrace(room: LiveRoom, participantId: string, release: () => void) {
    clearMarkerGrace(room, participantId);
    if (!holdsMarker(room, participantId)) {
        return false;
    }
    const timer = setTimeout(() => {
        room.markerGrace.delete(participantId);
        release();
    }, MARKER_GRACE_MS);
    timer.unref?.();
    room.markerGrace.set(participantId, timer);
    return true;
}

export function forgetLiveRoom(id: string) {
    const room = liveRooms.get(id);
    if (room) {
        clearMarkerGrace(room);
    }
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

export function trimReplay(room: LiveRoom) {
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
    if (room.markerGrace.has(holderId)) {
        return false;
    }
    const holder = room.admitted.get(holderId);
    if (!holder) {
        return true;
    }
    return Date.now() - holder.activeAt >= HOLDER_IDLE_MS;
}

function isAvatarIndex(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 0 && (value as number) < AVATAR_COUNT;
}

function takenAvatars(room: LiveRoom, exceptId?: string) {
    const taken = new Set<number>();
    for (const seat of [...room.admitted.values(), ...room.waiting.values()]) {
        if (seat.participantId !== exceptId && isAvatarIndex(seat.avatar)) {
            taken.add(seat.avatar);
        }
    }
    return taken;
}

export function assignAvatar(room: LiveRoom, participantId: string) {
    if (room.avatarOrder.length !== AVATAR_COUNT) {
        room.avatarOrder = shuffled(AVATAR_COUNT);
    }
    const taken = takenAvatars(room, participantId);
    const remembered = room.avatars.get(participantId);
    if (isAvatarIndex(remembered) && !taken.has(remembered)) {
        room.avatars.set(participantId, remembered);
        return remembered;
    }
    for (const index of room.avatarOrder) {
        if (!taken.has(index)) {
            room.avatars.set(participantId, index);
            return index;
        }
    }
    for (let index = 0; index < AVATAR_COUNT; index += 1) {
        if (!taken.has(index)) {
            room.avatars.set(participantId, index);
            return index;
        }
    }
    return remembered ?? 0;
}

/** Repair seats that never got a face, or that collided on the same index. */
export function ensureUniqueAvatars(room: LiveRoom) {
    if (room.avatarOrder.length !== AVATAR_COUNT) {
        room.avatarOrder = shuffled(AVATAR_COUNT);
    }
    const seats = [...room.admitted.values(), ...room.waiting.values()];
    const used = new Set<number>();
    for (const seat of seats) {
        if (isAvatarIndex(seat.avatar) && !used.has(seat.avatar)) {
            used.add(seat.avatar);
            room.avatars.set(seat.participantId, seat.avatar);
            continue;
        }
        room.avatars.delete(seat.participantId);
        seat.avatar = assignAvatar(room, seat.participantId);
        used.add(seat.avatar);
    }
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
