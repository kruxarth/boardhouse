import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { JWT_SECRET } from "@repo/backend-common/config";
import { MAX_CANVAS_MESSAGE_BYTES, MAX_SEATS, MAX_WAITERS } from "@repo/common/constants";
import { ClientMessageSchema, type RoomStatePayload } from "@repo/common/types";
import { prismaClient } from "@repo/db";
import { enqueueRoomEvent } from "./queue";
import { deleteLivekitRooms } from "./livekit";
import {
    appendReplay,
    createLiveRoom,
    dropMarkersHeldBy,
    forgetLiveRoom,
    getLiveRoom,
    guestSeatOpen,
    holdsMarker,
    hostSeatOpen,
    isExpired,
    liveRooms,
    newAsk,
    rememberLiveRoom,
    slotHeldBy,
    type LiveRoom,
    type Seat,
} from "./store";

const wss = new WebSocketServer({ port: 8081 });

type Session = {
    participantId: string;
    name: string;
};

type Connection = {
    ws: WebSocket;
    session: Session;
    room: LiveRoom | null;
    viaFormerSlug: boolean;
};

function sendJson(ws: WebSocket, payload: unknown) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

function sendError(ws: WebSocket, message: string) {
    sendJson(ws, { type: "error", message });
}

function readSession(token: string): Session | null {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (
            typeof decoded === "string" ||
            typeof decoded.sub !== "string" ||
            typeof decoded.name !== "string"
        ) {
            return null;
        }
        return { participantId: decoded.sub, name: decoded.name };
    } catch {
        return null;
    }
}

function presenceOf(seat: Seat) {
    return { id: seat.participantId, name: seat.name, muted: seat.muted };
}

function roomState(room: LiveRoom, forHost: boolean, viaFormerSlug: boolean): RoomStatePayload {
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

function broadcastAdmitted(room: LiveRoom, payload: unknown, except?: WebSocket) {
    for (const seat of room.admitted.values()) {
        if (seat.ws !== except) {
            sendJson(seat.ws, payload);
        }
    }
}

function broadcastRoomState(room: LiveRoom) {
    for (const seat of room.admitted.values()) {
        const isHost = seat.participantId === room.hostParticipantId;
        sendJson(seat.ws, roomState(room, isHost, false));
    }
    for (const seat of room.waiting.values()) {
        sendJson(seat.ws, roomState(room, false, true));
    }
}

function broadcastMarkers(room: LiveRoom) {
    const payload = { type: "marker_state", slots: room.markers };
    broadcastAdmitted(room, payload);
    appendReplay(room, "marker", { slots: room.markers });
}

function closeSitting(room: LiveRoom, message = "This sitting is over") {
    const payload = { type: "expired", message };
    for (const seat of [...room.admitted.values(), ...room.waiting.values()]) {
        sendJson(seat.ws, payload);
        seat.ws.close(4000, "this sitting is over");
    }
    forgetLiveRoom(room.id);
}

async function wipeSitting(room: LiveRoom, message = "This sitting is over") {
    const slugs = [room.slug, ...room.formerSlugs];
    try {
        await prismaClient.room.delete({ where: { id: room.id } });
    } catch {
        // Already gone.
    }
    closeSitting(room, message);
    await deleteLivekitRooms(slugs);
}

function detachSocket(room: LiveRoom, ws: WebSocket) {
    for (const [id, seat] of room.admitted) {
        if (seat.ws === ws) {
            room.admitted.delete(id);
            const markerChanged = dropMarkersHeldBy(room, id);
            broadcastAdmitted(room, {
                type: "participant_left",
                participantId: id,
            });
            if (markerChanged) {
                broadcastMarkers(room);
            }
            broadcastRoomState(room);
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

function makeSeat(connection: Connection, admitted: boolean): Seat {
    return {
        ws: connection.ws,
        participantId: connection.session.participantId,
        name: connection.session.name,
        muted: true,
        admitted,
    };
}

async function loadRoom(slug: string) {
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
    if (!live) {
        live = createLiveRoom(row);
        rememberLiveRoom(live);
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

function admit(room: LiveRoom, connection: Connection) {
    replaceExisting(room, connection.session.participantId, connection.ws);
    room.waiting.delete(connection.session.participantId);
    const seat = makeSeat(connection, true);
    room.admitted.set(seat.participantId, seat);
    connection.room = room;
    connection.viaFormerSlug = false;

    sendJson(connection.ws, { type: "joined", slug: room.slug });
    sendJson(connection.ws, roomState(room, seat.participantId === room.hostParticipantId, false));
    sendJson(connection.ws, { type: "marker_state", slots: room.markers });
    if (room.canvas) {
        sendJson(connection.ws, { type: "canvas_snapshot", payload: room.canvas });
    }
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

function putInWaiting(room: LiveRoom, connection: Connection, viaFormer: boolean) {
    replaceExisting(room, connection.session.participantId, connection.ws);
    if (room.waiting.size >= MAX_WAITERS && !room.waiting.has(connection.session.participantId)) {
        sendJson(connection.ws, { type: "full", message: "Too many people at the door" });
        return;
    }
    const seat = makeSeat(connection, false);
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
}

function isHost(room: LiveRoom, participantId: string) {
    return room.hostParticipantId === participantId;
}

async function reclaimHost(room: LiveRoom, participantId: string) {
    const previous = room.hostParticipantId;
    room.hostParticipantId = participantId;
    if (room.markers[0] === previous) {
        room.markers[0] = participantId;
    }
    await prismaClient.room.update({
        where: { id: room.id },
        data: { hostParticipantId: participantId },
    });
}

async function handleJoin(connection: Connection, roomId: string, hostKey?: string) {
    const loaded = await loadRoom(roomId);
    if (loaded === "missing") {
        sendJson(connection.ws, { type: "missing", message: "No table at this door" });
        return;
    }
    if (loaded === "expired") {
        sendJson(connection.ws, { type: "expired", message: "This sitting is over" });
        return;
    }

    const { live, viaFormer } = loaded;
    await enqueueRoomEvent(live.id, async () => {
        if (isExpired(live)) {
            closeSitting(live);
            sendJson(connection.ws, { type: "expired", message: "This sitting is over" });
            return;
        }

        const validHostKey = Boolean(hostKey && hostKey === live.hostKey);
        if (validHostKey && connection.session.participantId !== live.hostParticipantId) {
            await reclaimHost(live, connection.session.participantId);
        }

        const host = validHostKey || isHost(live, connection.session.participantId);

        if (host) {
            if (!hostSeatOpen(live) && !live.admitted.has(connection.session.participantId)) {
                sendJson(connection.ws, { type: "full", message: "The table is full" });
                return;
            }
            admit(live, connection);
            return;
        }

        if (live.admitted.has(connection.session.participantId)) {
            admit(live, connection);
            return;
        }

        const forceKnock = viaFormer || live.accessMode === "knock";
        if (forceKnock) {
            putInWaiting(live, connection, viaFormer);
            return;
        }

        if (!guestSeatOpen(live)) {
            sendJson(connection.ws, { type: "full", message: "The table is full" });
            return;
        }

        admit(live, connection);
    });
}

function requireAdmitted(connection: Connection): LiveRoom | null {
    const room = connection.room;
    if (!room) {
        sendError(connection.ws, "Join a table first");
        return null;
    }
    if (isExpired(room)) {
        closeSitting(room);
        return null;
    }
    if (!room.admitted.has(connection.session.participantId)) {
        sendError(connection.ws, "You are not at the table");
        return null;
    }
    return room;
}

function requireHost(connection: Connection): LiveRoom | null {
    const room = requireAdmitted(connection);
    if (!room) {
        return null;
    }
    if (!isHost(room, connection.session.participantId)) {
        sendError(connection.ws, "Only the host can do that");
        return null;
    }
    return room;
}

async function handleMessage(connection: Connection, data: RawData) {
    const raw = data.toString();
    if (raw.length > MAX_CANVAS_MESSAGE_BYTES) {
        sendError(connection.ws, "Message too large");
        return;
    }

    let parsedJson: unknown;
    try {
        parsedJson = JSON.parse(raw);
    } catch {
        sendError(connection.ws, "Message must be valid JSON");
        return;
    }

    const parsed = ClientMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
        sendError(connection.ws, "Invalid WebSocket message");
        return;
    }

    const message = parsed.data;

    if (message.type === "join") {
        await handleJoin(connection, message.roomId, message.hostKey);
        return;
    }

    if (message.type === "leave") {
        if (connection.room) {
            detachSocket(connection.room, connection.ws);
            connection.room = null;
        }
        sendJson(connection.ws, { type: "left" });
        return;
    }

    if (message.type === "knock") {
        const room = connection.room;
        if (!room || !room.waiting.has(connection.session.participantId)) {
            sendError(connection.ws, "You are not waiting at this door");
            return;
        }
        const seat = room.waiting.get(connection.session.participantId);
        const host = room.admitted.get(room.hostParticipantId);
        if (seat && host) {
            sendJson(host.ws, { type: "knock", participant: presenceOf(seat) });
        }
        return;
    }

    const roomId = connection.room?.id;
    if (!roomId) {
        sendError(connection.ws, "Join a table first");
        return;
    }

    await enqueueRoomEvent(roomId, async () => {
        if (message.type === "admit") {
            const room = requireHost(connection);
            if (!room) {
                return;
            }
            const waiter = room.waiting.get(message.participantId);
            if (!waiter) {
                sendError(connection.ws, "That person is not waiting");
                return;
            }
            if (!guestSeatOpen(room) && !room.admitted.has(message.participantId)) {
                sendJson(connection.ws, { type: "full", message: "The table is full" });
                sendJson(waiter.ws, { type: "full", message: "The table is full" });
                return;
            }
            const guestConnection: Connection = {
                ws: waiter.ws,
                session: { participantId: waiter.participantId, name: waiter.name },
                room,
                viaFormerSlug: false,
            };
            admit(room, guestConnection);
            return;
        }

        if (message.type === "deny") {
            const room = requireHost(connection);
            if (!room) {
                return;
            }
            const waiter = room.waiting.get(message.participantId);
            if (!waiter) {
                return;
            }
            room.waiting.delete(message.participantId);
            sendJson(waiter.ws, { type: "denied", message: "The host kept the door closed" });
            broadcastRoomState(room);
            return;
        }

        if (message.type === "set_mode") {
            const room = requireHost(connection);
            if (!room) {
                return;
            }
            room.accessMode = message.accessMode;
            await prismaClient.room.update({
                where: { id: room.id },
                data: { accessMode: message.accessMode },
            });
            broadcastRoomState(room);
            return;
        }

        if (message.type === "rotate_slug") {
            const room = requireHost(connection);
            if (!room) {
                return;
            }
            const oldSlug = room.slug;
            const nextSlug = `table-${randomUUID().slice(0, 8)}`;
            room.formerSlugs.add(oldSlug);
            room.slug = nextSlug;
            await prismaClient.room.update({
                where: { id: room.id },
                data: {
                    slug: nextSlug,
                    formerSlugs: [...room.formerSlugs],
                },
            });
            broadcastAdmitted(room, {
                type: "slug_rotated",
                slug: nextSlug,
                formerSlug: oldSlug,
            });
            broadcastRoomState(room);
            return;
        }

        if (message.type === "end_room") {
            const room = requireHost(connection);
            if (!room) {
                return;
            }
            await wipeSitting(room, "The host ended this sitting");
            return;
        }

        if (message.type === "take_marker") {
            const room = requireAdmitted(connection);
            if (!room) {
                return;
            }
            if (room.markers[message.slot] !== null) {
                sendError(connection.ws, "That marker is already taken");
                return;
            }
            room.markers[message.slot] = connection.session.participantId;
            broadcastMarkers(room);
            sendJson(connection.ws, {
                type: "marker_ack",
                slots: room.markers,
            });
            return;
        }

        if (message.type === "ask_marker") {
            const room = requireAdmitted(connection);
            if (!room) {
                return;
            }
            const holderId = message.fromParticipantId;
            const slot = slotHeldBy(room, holderId);
            if (slot === null) {
                sendError(connection.ws, "They do not have a marker");
                return;
            }
            if (holderId === connection.session.participantId) {
                sendError(connection.ws, "You already have that marker");
                return;
            }
            const ask = newAsk(connection.session.participantId, holderId, slot);
            room.asks.set(ask.requestId, ask);
            const holder = room.admitted.get(holderId);
            const payload = {
                type: "marker_ask",
                requestId: ask.requestId,
                fromParticipantId: ask.fromParticipantId,
                fromName: connection.session.name,
                slot: ask.slot,
            };
            if (holder) {
                sendJson(holder.ws, payload);
            }
            return;
        }

        if (message.type === "answer_marker") {
            const room = requireAdmitted(connection);
            if (!room) {
                return;
            }
            const ask = room.asks.get(message.requestId);
            if (!ask) {
                sendError(connection.ws, "That ask is gone");
                return;
            }
            if (ask.holderId !== connection.session.participantId) {
                sendError(connection.ws, "That ask is not for you");
                return;
            }
            room.asks.delete(message.requestId);
            const asker = room.admitted.get(ask.fromParticipantId);
            if (message.give && room.markers[ask.slot] === ask.holderId && asker) {
                room.markers[ask.slot] = ask.fromParticipantId;
                broadcastMarkers(room);
            } else if (asker) {
                sendJson(asker.ws, {
                    type: "marker_kept",
                    slot: ask.slot,
                    holderId: ask.holderId,
                });
            }
            return;
        }

        if (message.type === "drop_marker") {
            const room = requireAdmitted(connection);
            if (!room) {
                return;
            }
            if (room.markers[message.slot] !== connection.session.participantId) {
                sendError(connection.ws, "You are not holding that marker");
                return;
            }
            room.markers[message.slot] = null;
            broadcastMarkers(room);
            return;
        }

        if (message.type === "give_marker") {
            const room = requireAdmitted(connection);
            if (!room) {
                return;
            }
            if (room.markers[message.slot] !== connection.session.participantId) {
                sendError(connection.ws, "You are not holding that marker");
                return;
            }
            if (!room.admitted.has(message.toParticipantId)) {
                sendError(connection.ws, "They are not at the table");
                return;
            }
            room.markers[message.slot] = message.toParticipantId;
            broadcastMarkers(room);
            return;
        }

        if (message.type === "host_take_marker") {
            const room = requireHost(connection);
            if (!room) {
                return;
            }
            room.markers[message.slot] = connection.session.participantId;
            broadcastMarkers(room);
            return;
        }

        if (message.type === "host_give_marker") {
            const room = requireHost(connection);
            if (!room) {
                return;
            }
            if (!room.admitted.has(message.toParticipantId)) {
                sendError(connection.ws, "They are not at the table");
                return;
            }
            room.markers[message.slot] = message.toParticipantId;
            broadcastMarkers(room);
            return;
        }

        if (message.type === "canvas") {
            const room = requireAdmitted(connection);
            if (!room) {
                return;
            }
            if (!holdsMarker(room, connection.session.participantId)) {
                sendError(connection.ws, "Only marker holders can draw");
                return;
            }
            room.canvas = message.payload;
            appendReplay(room, "canvas", message.payload);
            broadcastAdmitted(
                room,
                { type: "canvas", payload: message.payload },
                connection.ws
            );
            sendJson(connection.ws, { type: "canvas_ack" });
            return;
        }

        if (message.type === "cursor") {
            const room = requireAdmitted(connection);
            if (!room) {
                return;
            }
            broadcastAdmitted(
                room,
                {
                    type: "cursor",
                    participantId: connection.session.participantId,
                    name: connection.session.name,
                    x: message.x,
                    y: message.y,
                },
                connection.ws
            );
            return;
        }

        if (message.type === "mute_participant") {
            const room = requireHost(connection);
            if (!room) {
                return;
            }
            const target = room.admitted.get(message.participantId);
            if (!target) {
                sendError(connection.ws, "They are not at the table");
                return;
            }
            target.muted = true;
            sendJson(target.ws, { type: "force_mute" });
            broadcastRoomState(room);
            return;
        }

        if (message.type === "set_muted") {
            const room = requireAdmitted(connection);
            if (!room) {
                return;
            }
            const seat = room.admitted.get(connection.session.participantId);
            if (seat) {
                seat.muted = message.muted;
                broadcastRoomState(room);
            }
            return;
        }

        if (message.type === "get_replay") {
            const room = requireAdmitted(connection);
            if (!room) {
                return;
            }
            sendJson(connection.ws, {
                type: "replay",
                version: 1,
                startedAt: new Date(room.startedAt).toISOString(),
                slug: room.slug,
                events: room.replay,
            });
        }
    });
}

const connections = new Set<Connection>();

wss.on("listening", () => {
    console.log("WebSocket backend running on ws://localhost:8081");
});

wss.on("connection", (ws, request) => {
    const url = new URL(request.url ?? "/", "ws://localhost");
    const token = url.searchParams.get("token");

    if (!token) {
        ws.close(1008, "Missing token");
        return;
    }

    const session = readSession(token);
    if (!session) {
        ws.close(1008, "Invalid token");
        return;
    }

    const connection: Connection = {
        ws,
        session,
        room: null,
        viaFormerSlug: false,
    };
    connections.add(connection);

    let messageChain = Promise.resolve();
    ws.on("message", (data) => {
        messageChain = messageChain
            .then(() => handleMessage(connection, data))
            .catch((error) => {
                console.error("Error handling WebSocket message:", error);
                sendError(ws, "Could not process message");
            });
    });

    ws.on("close", () => {
        connections.delete(connection);
        if (connection.room) {
            detachSocket(connection.room, ws);
        }
    });

    ws.on("error", (error) => {
        console.error("WebSocket error:", error);
    });
});

setInterval(() => {
    for (const room of liveRooms.values()) {
        if (isExpired(room)) {
            closeSitting(room);
        }
    }
}, 15_000);
