import { readSessionToken } from "@repo/backend-common/config";
import { KICKED_CLOSE_CODE, MAX_SEATS, MAX_WAITERS } from "@repo/common/constants";
import type { AskOutcome, RoomStatePayload, ServerMessage } from "@repo/common/types";
import { prismaClient } from "@repo/db";
import { deleteLivekitRooms } from "@repo/backend-common/livekit";
import { WebSocket } from "ws";
import { clearAuthTimeout, type Connection, type Session } from "./connection";
import { keysMatch } from "./keys";
import {
    asksHeldBy,
    armMarkerGrace,
    assignAvatar,
    clearAsksForSlot,
    clearMarkerGrace,
    createLiveRoom,
    dropMarkersHeldBy,
    ensureUniqueAvatars,
    forgetLiveRoom,
    getLiveRoom,
    isExpired,
    lapsedAsks,
    pendingAskFrom,
    rememberLiveRoom,
    retargetAsks,
    startCooldown,
    type LiveRoom,
    type MarkerAsk,
    type Seat,
} from "./store";

export function sendJson(ws: WebSocket, payload: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

export function sendError(ws: WebSocket, message: string) {
    sendJson(ws, { type: "error", message });
}

export function readSession(token: string): Session | null {
    const claims = readSessionToken(token);
    if (!claims) {
        return null;
    }
    return { participantId: claims.sub, name: claims.name };
}

function presenceOf(seat: Seat) {
    return {
        id: seat.participantId,
        name: seat.name,
        muted: seat.muted,
        avatar: Number.isInteger(seat.avatar) ? seat.avatar : 0,
    };
}

export function roomState(room: LiveRoom, forHost: boolean, viaFormerSlug: boolean): RoomStatePayload {
    ensureUniqueAvatars(room);
    return {
        type: "room_state",
        slug: room.slug,
        name: room.name,
        accessMode: room.accessMode,
        expiresAt: new Date(room.expiresAt).toISOString(),
        hostParticipantId: room.hostParticipantId,
        seats: [...room.admitted.values()].map(presenceOf),
        waiters: forHost ? [...room.waiting.values()].map(presenceOf) : [],
        markers: room.markers,
        usedSeats: room.admitted.size,
        maxSeats: MAX_SEATS,
        viaFormerSlug,
    };
}

export function broadcastAdmitted(room: LiveRoom, payload: ServerMessage, except?: WebSocket) {
    for (const seat of room.admitted.values()) {
        if (seat.ws !== except) {
            sendJson(seat.ws, payload);
        }
    }
}

export function broadcastRoomState(room: LiveRoom) {
    for (const seat of room.admitted.values()) {
        const isHostSeat = seat.participantId === room.hostParticipantId;
        sendJson(seat.ws, roomState(room, isHostSeat, false));
    }
    for (const seat of room.waiting.values()) {
        sendJson(seat.ws, roomState(room, false, true));
    }
}

export function broadcastMarkers(room: LiveRoom) {
    broadcastAdmitted(room, { type: "marker_state", slots: room.markers });
}

function askPayload(room: LiveRoom, ask: MarkerAsk) {
    const from = room.admitted.get(ask.fromParticipantId);
    return {
        requestId: ask.requestId,
        fromParticipantId: ask.fromParticipantId,
        fromName: from?.name ?? "Someone",
        fromAvatar: from?.avatar ?? 0,
        slot: ask.slot,
        expiresAt: new Date(ask.expiresAt).toISOString(),
    };
}

export function sendAsks(room: LiveRoom, holderId: string) {
    const holder = room.admitted.get(holderId);
    if (!holder) {
        return;
    }
    sendJson(holder.ws, {
        type: "marker_asks",
        asks: asksHeldBy(room, holderId).map((ask) => askPayload(room, ask)),
    });
}

export function sendPendingAsk(room: LiveRoom, participantId: string) {
    const seat = room.admitted.get(participantId);
    if (!seat) {
        return;
    }
    const ask = pendingAskFrom(room, participantId);
    sendJson(seat.ws, {
        type: "marker_ask_state",
        ask: ask
            ? {
                  requestId: ask.requestId,
                  slot: ask.slot,
                  holderId: ask.holderId,
                  holderName: room.admitted.get(ask.holderId)?.name ?? "someone",
                  expiresAt: new Date(ask.expiresAt).toISOString(),
              }
            : null,
    });
}

export function settleAsk(room: LiveRoom, ask: MarkerAsk, outcome: AskOutcome) {
    if (outcome !== "given") {
        startCooldown(room, ask.fromParticipantId, ask.slot);
    }
    const asker = room.admitted.get(ask.fromParticipantId);
    if (asker) {
        sendJson(asker.ws, { type: "marker_ask_done", slot: ask.slot, outcome });
    }
    sendPendingAsk(room, ask.fromParticipantId);
}

export function refreshAsks(room: LiveRoom, extraIds: string[] = []) {
    const ids = new Set<string>(extraIds);
    for (const holderId of room.markers) {
        if (holderId) {
            ids.add(holderId);
        }
    }
    for (const id of ids) {
        sendAsks(room, id);
    }
}

export function touchSeat(room: LiveRoom, participantId: string) {
    const seat = room.admitted.get(participantId);
    if (seat) {
        seat.activeAt = Date.now();
    }
}

export function moveMarker(room: LiveRoom, slot: 0 | 1, holderId: string | null, extraIds: string[] = []) {
    const previous = room.markers[slot];
    if (previous && previous !== holderId) {
        clearMarkerGrace(room, previous);
    }
    if (holderId) {
        clearMarkerGrace(room, holderId);
    }
    room.markers[slot] = holderId;
    if (previous) {
        touchSeat(room, previous);
    }
    if (holderId) {
        touchSeat(room, holderId);
    }
    const settled: Array<[MarkerAsk, AskOutcome]> = [];
    if (holderId) {
        for (const ask of retargetAsks(room, slot, holderId)) {
            settled.push([ask, "given"]);
        }
    } else {
        for (const ask of clearAsksForSlot(room, slot)) {
            settled.push([ask, "lapsed"]);
        }
    }
    broadcastMarkers(room);
    for (const [ask, outcome] of settled) {
        settleAsk(room, ask, outcome);
    }
    refreshAsks(room, [...extraIds, previous].filter((id): id is string => Boolean(id)));
}

export function sweepLapsedAsks(room: LiveRoom) {
    const lapsed = lapsedAsks(room);
    if (lapsed.length === 0) {
        return;
    }
    const holders = new Set<string>();
    for (const ask of lapsed) {
        room.asks.delete(ask.requestId);
        holders.add(ask.holderId);
    }
    for (const ask of lapsed) {
        settleAsk(room, ask, "lapsed");
    }
    for (const holderId of holders) {
        sendAsks(room, holderId);
    }
}

export function closeSitting(room: LiveRoom, message = "This sitting is over") {
    const payload = { type: "expired" as const, message };
    for (const seat of [...room.admitted.values(), ...room.waiting.values()]) {
        sendJson(seat.ws, payload);
        seat.ws.close(4000, "this sitting is over");
    }
    forgetLiveRoom(room.id);
}

export async function wipeSitting(room: LiveRoom, message = "This sitting is over") {
    const slugs = [room.slug, ...room.formerSlugs];
    try {
        await prismaClient.room.delete({ where: { id: room.id } });
    } catch {
        // Already gone.
    }
    closeSitting(room, message);
    await deleteLivekitRooms(slugs);
}

async function persistEmptySince(room: LiveRoom) {
    try {
        await prismaClient.room.update({
            where: { id: room.id },
            data: { emptySince: room.emptySince === null ? null : new Date(room.emptySince) },
        });
    } catch {
        // Room already wiped.
    }
}

export function persistSeated(room: LiveRoom) {
    const seated = room.admitted.size;
    if (room.seatedPersisted === seated) {
        return;
    }
    room.seatedPersisted = seated;
    void prismaClient.room
        .update({
            where: { id: room.id },
            data: { seated },
        })
        .catch(() => {
            room.seatedPersisted = -1;
        });
}

function releaseHeldMarkers(room: LiveRoom, participantId: string) {
    const { changed, dropped } = dropMarkersHeldBy(room, participantId);
    if (changed) {
        broadcastMarkers(room);
    }
    for (const ask of dropped) {
        if (ask.fromParticipantId !== participantId) {
            settleAsk(room, ask, "lapsed");
        }
    }
    refreshAsks(room);
    broadcastRoomState(room);
}

export const SHOWN_OUT_MESSAGE = "The host showed you out of this table";

/** The host showed someone out: their markers free up now, not after the grace, and the socket closes for good. */
export function showOut(room: LiveRoom, participantId: string) {
    room.kicked.add(participantId);
    const seat = room.admitted.get(participantId) ?? room.waiting.get(participantId);
    if (!seat) {
        return false;
    }
    sendJson(seat.ws, { type: "removed", message: SHOWN_OUT_MESSAGE });
    detachSocket(room, seat.ws);
    clearMarkerGrace(room, participantId);
    releaseHeldMarkers(room, participantId);
    seat.ws.close(KICKED_CLOSE_CODE, "Shown out");
    return true;
}

export function markTableEmpty(room: LiveRoom) {
    if (room.admitted.size > 0) {
        return;
    }
    if (room.emptySince === null) {
        room.emptySince = Date.now();
        void persistEmptySince(room);
    }
}

export function markTableOccupied(room: LiveRoom) {
    if (room.emptySince === null) {
        return;
    }
    room.emptySince = null;
    void persistEmptySince(room);
}

export function detachSocket(room: LiveRoom, ws: WebSocket) {
    for (const [id, seat] of room.admitted) {
        if (seat.ws === ws) {
            room.admitted.delete(id);
            const deferred = armMarkerGrace(room, id, () => {
                if (getLiveRoom(room.id) !== room || room.admitted.has(id)) {
                    return;
                }
                releaseHeldMarkers(room, id);
            });
            broadcastAdmitted(room, {
                type: "participant_left",
                participantId: id,
            });
            if (!deferred) {
                releaseHeldMarkers(room, id);
            } else {
                broadcastRoomState(room);
            }
            persistSeated(room);
            markTableEmpty(room);
            return;
        }
    }
    for (const [id, seat] of room.waiting) {
        if (seat.ws === ws) {
            room.waiting.delete(id);
            broadcastRoomState(room);
            return;
        }
    }
}

function releaseOtherRoom(connection: Connection, next: LiveRoom) {
    if (connection.room && connection.room !== next) {
        detachSocket(connection.room, connection.ws);
        connection.room = null;
    }
}

function replaceExisting(room: LiveRoom, participantId: string, incoming: WebSocket) {
    const existing = room.admitted.get(participantId) ?? room.waiting.get(participantId);
    if (existing && existing.ws !== incoming) {
        sendJson(existing.ws, {
            type: "error",
            message: "Connected from another tab",
        });
        existing.ws.close(4001, "replaced");
        room.admitted.delete(participantId);
        room.waiting.delete(participantId);
    }
}

export function sessionOf(connection: Connection): Session {
    if (!connection.session) {
        throw new Error("unauthenticated");
    }
    return connection.session;
}

export function authenticate(connection: Connection, token?: string): Session | null {
    if (connection.session) {
        return connection.session;
    }
    if (!token) {
        sendJson(connection.ws, { type: "auth_error", message: "Missing token" });
        return null;
    }
    const session = readSession(token);
    if (!session) {
        sendJson(connection.ws, { type: "auth_error", message: "Invalid token" });
        return null;
    }
    connection.session = session;
    clearAuthTimeout(connection);
    return session;
}

function makeSeat(room: LiveRoom, connection: Connection, admitted: boolean): Seat {
    const session = connection.session;
    if (!session) {
        throw new Error("unauthenticated");
    }
    return {
        ws: connection.ws,
        participantId: session.participantId,
        name: session.name,
        muted: true,
        admitted,
        avatar: assignAvatar(room, session.participantId),
        activeAt: Date.now(),
        reactedAt: 0,
        replayedAt: 0,
        lastKnockAt: 0,
    };
}

export async function loadRoom(slug: string) {
    const row = await prismaClient.room.findFirst({
        where: {
            OR: [{ slug }, { formerSlugs: { has: slug } }],
        },
    });
    if (!row) {
        return "missing" as const;
    }
    if (row.expiresAt.getTime() <= Date.now()) {
        const live = getLiveRoom(row.id);
        if (live) {
            closeSitting(live);
        }
        return "expired" as const;
    }

    let live = getLiveRoom(row.id);
    if (live && live.hostKey !== row.hostKey) {
        closeSitting(live, "This table was claimed");
        live = undefined;
    }
    if (!live) {
        live = createLiveRoom(row);
        rememberLiveRoom(live);
        if (!row.emptySince) {
            void persistEmptySince(live);
        }
    } else {
        live.slug = row.slug;
        live.formerSlugs = new Set(row.formerSlugs);
        live.hostKey = row.hostKey;
        live.hostParticipantId = row.hostParticipantId;
        live.accessMode = row.accessMode === "open" ? "open" : "knock";
        live.name = row.name;
        live.expiresAt = row.expiresAt.getTime();
    }
    return { live, viaFormer: row.slug !== slug };
}

export function admit(room: LiveRoom, connection: Connection) {
    releaseOtherRoom(connection, room);
    replaceExisting(room, sessionOf(connection).participantId, connection.ws);
    room.waiting.delete(sessionOf(connection).participantId);
    clearMarkerGrace(room, sessionOf(connection).participantId);
    const seat = makeSeat(room, connection, true);
    room.admitted.set(seat.participantId, seat);
    persistSeated(room);
    markTableOccupied(room);
    connection.room = room;
    connection.viaFormerSlug = false;

    sendJson(connection.ws, { type: "joined", slug: room.slug });
    sendJson(connection.ws, roomState(room, seat.participantId === room.hostParticipantId, false));
    sendJson(connection.ws, { type: "marker_state", slots: room.markers });
    sendAsks(room, seat.participantId);
    sendPendingAsk(room, seat.participantId);
    sendJson(connection.ws, { type: "canvas_snapshot", payload: room.canvas });
    broadcastAdmitted(
        room,
        {
            type: "participant_joined",
            participant: presenceOf(seat),
        },
        connection.ws
    );
    broadcastRoomState(room);
}

export function putInWaiting(room: LiveRoom, connection: Connection, viaFormer: boolean) {
    releaseOtherRoom(connection, room);
    replaceExisting(room, sessionOf(connection).participantId, connection.ws);
    if (room.waiting.size >= MAX_WAITERS && !room.waiting.has(sessionOf(connection).participantId)) {
        sendJson(connection.ws, { type: "full", message: "Too many people at the door" });
        return;
    }
    const seat = makeSeat(room, connection, false);
    seat.lastKnockAt = Date.now();
    room.waiting.set(seat.participantId, seat);
    connection.room = room;
    connection.viaFormerSlug = viaFormer;
    sendJson(connection.ws, { type: "waiting" });
    const host = room.admitted.get(room.hostParticipantId);
    if (host) {
        sendJson(host.ws, {
            type: "knock",
            participant: presenceOf(seat),
        });
        sendJson(host.ws, roomState(room, true, false));
    }
    sendJson(connection.ws, roomState(room, false, viaFormer));
}

export function isHost(room: LiveRoom, participantId: string) {
    return room.hostParticipantId === participantId;
}

export async function reclaimHost(room: LiveRoom, participantId: string) {
    await prismaClient.room.update({
        where: { id: room.id },
        data: { hostParticipantId: participantId },
    });
    const previous = room.hostParticipantId;
    room.hostParticipantId = participantId;
    if (room.markers[0] === previous) {
        room.markers[0] = participantId;
    }
}

export function hostKeyMatches(hostKey: string | undefined, room: LiveRoom) {
    return Boolean(hostKey && keysMatch(hostKey, room.hostKey));
}

export function requireAdmitted(connection: Connection): LiveRoom | null {
    const session = connection.session;
    if (!session) {
        sendJson(connection.ws, { type: "auth_error", message: "Invalid token" });
        return null;
    }
    const room = connection.room;
    if (!room) {
        sendError(connection.ws, "Join a table first");
        return null;
    }
    if (isExpired(room)) {
        closeSitting(room);
        return null;
    }
    if (!room.admitted.has(session.participantId)) {
        sendError(connection.ws, "You are not at the table");
        return null;
    }
    return room;
}

export function requireHost(connection: Connection): LiveRoom | null {
    const room = requireAdmitted(connection);
    if (!room || !connection.session) {
        return null;
    }
    if (!isHost(room, sessionOf(connection).participantId)) {
        sendError(connection.ws, "Only the host can do that");
        return null;
    }
    return room;
}
