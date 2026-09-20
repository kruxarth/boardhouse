import { createServer } from "http";
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
    asksHeldBy,
    clearAsksForSlot,
    createLiveRoom,
    dropMarkersHeldBy,
    existingAsk,
    exportReplay,
    forgetLiveRoom,
    getLiveRoom,
    guestSeatOpen,
    holdsMarker,
    hostSeatOpen,
    isExpired,
    liveRooms,
    newAsk,
    rememberLiveRoom,
    retargetAsks,
    slotHeldBy,
    type LiveRoom,
    type Seat,
} from "./store";

const port = Number(process.env.PORT) || 8081;
const httpServer = createServer((req, res) => {
    const path = req.url?.split("?")[0];
    if (path === "/health") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
        return;
    }
    res.writeHead(404);
    res.end();
});
const wss = new WebSocketServer({
    server: httpServer,
    perMessageDeflate: false,
});

type Session = {
    participantId: string;
    name: string;
};

type Connection = {
    ws: WebSocket;
    session: Session | null;
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

function askPayload(room: LiveRoom, ask: { requestId: string; fromParticipantId: string; slot: 0 | 1 }) {
    const from = room.admitted.get(ask.fromParticipantId);
    return {
        requestId: ask.requestId,
        fromParticipantId: ask.fromParticipantId,
        fromName: from?.name ?? "Someone",
        slot: ask.slot,
    };
}

function sendAsks(room: LiveRoom, holderId: string) {
    const holder = room.admitted.get(holderId);
    if (!holder) {
        return;
    }
    sendJson(holder.ws, {
        type: "marker_asks",
        asks: asksHeldBy(room, holderId).map((ask) => askPayload(room, ask)),
    });
}

function refreshAsks(room: LiveRoom, extraIds: string[] = []) {
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

function moveMarker(room: LiveRoom, slot: 0 | 1, holderId: string | null, extraIds: string[] = []) {
    const previous = room.markers[slot];
    room.markers[slot] = holderId;
    if (holderId) {
        retargetAsks(room, slot, holderId);
    } else {
        clearAsksForSlot(room, slot);
    }
    broadcastMarkers(room);
    refreshAsks(room, [...extraIds, previous].filter((id): id is string => Boolean(id)));
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
            refreshAsks(room);
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

function sessionOf(connection: Connection): Session {
    if (!connection.session) {
        throw new Error("unauthenticated");
    }
    return connection.session;
}

function authenticate(connection: Connection, token?: string): Session | null {
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
    return session;
}

function makeSeat(connection: Connection, admitted: boolean): Seat {
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
    replaceExisting(room, sessionOf(connection).participantId, connection.ws);
    room.waiting.delete(sessionOf(connection).participantId);
    const seat = makeSeat(connection, true);
    room.admitted.set(seat.participantId, seat);
    connection.room = room;
    connection.viaFormerSlug = false;

    sendJson(connection.ws, { type: "joined", slug: room.slug });
    sendJson(connection.ws, roomState(room, seat.participantId === room.hostParticipantId, false));
    sendJson(connection.ws, { type: "marker_state", slots: room.markers });
    sendAsks(room, seat.participantId);
    sendJson(connection.ws, { type: "canvas_snapshot", payload: room.canvas ?? null });
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
    replaceExisting(room, sessionOf(connection).participantId, connection.ws);
    if (room.waiting.size >= MAX_WAITERS && !room.waiting.has(sessionOf(connection).participantId)) {
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

async function handleJoin(
    connection: Connection,
    roomId: string,
    hostKey?: string,
    token?: string,
    fromHouse = false
) {
    const session = authenticate(connection, token);
    if (!session) {
        return;
    }

    let loaded: Awaited<ReturnType<typeof loadRoom>>;
    try {
        loaded = await loadRoom(roomId);
    } catch (error) {
        console.error("Error loading room:", error);
        sendError(connection.ws, "Could not open this table");
        return;
    }
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
        if (validHostKey && session.participantId !== live.hostParticipantId) {
            await reclaimHost(live, session.participantId);
        }

        const host = validHostKey || isHost(live, session.participantId);

        if (host) {
            if (!hostSeatOpen(live) && !live.admitted.has(session.participantId)) {
                sendJson(connection.ws, { type: "full", message: "The table is full" });
                return;
            }
            admit(live, connection);
            return;
        }

        if (live.admitted.has(session.participantId)) {
            admit(live, connection);
            return;
        }

        const houseMustKnock = fromHouse && live.accessMode === "knock";
        if (viaFormer || houseMustKnock) {
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

function requireHost(connection: Connection): LiveRoom | null {
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
        await handleJoin(
            connection,
            message.roomId,
            message.hostKey,
            message.token,
            message.fromHouse === true
        );
        return;
    }

    if (!connection.session) {
        sendJson(connection.ws, { type: "auth_error", message: "Invalid token" });
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
        if (!room || !room.waiting.has(sessionOf(connection).participantId)) {
            sendError(connection.ws, "You are not waiting at this door");
            return;
        }
        const seat = room.waiting.get(sessionOf(connection).participantId);
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
            moveMarker(room, message.slot, sessionOf(connection).participantId);
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
            if (holderId === sessionOf(connection).participantId) {
                sendError(connection.ws, "You already have that marker");
                return;
            }
            const already = existingAsk(room, sessionOf(connection).participantId, holderId);
            if (already) {
                sendAsks(room, holderId);
                return;
            }
            const ask = newAsk(sessionOf(connection).participantId, holderId, slot);
            room.asks.set(ask.requestId, ask);
            sendAsks(room, holderId);
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
            if (ask.holderId !== sessionOf(connection).participantId) {
                sendError(connection.ws, "That ask is not for you");
                return;
            }
            room.asks.delete(message.requestId);
            const asker = room.admitted.get(ask.fromParticipantId);
            const oldHolder = ask.holderId;
            if (message.give && room.markers[ask.slot] === ask.holderId && asker) {
                moveMarker(room, ask.slot, ask.fromParticipantId, [oldHolder]);
            } else if (asker) {
                sendJson(asker.ws, {
                    type: "marker_kept",
                    slot: ask.slot,
                    holderId: ask.holderId,
                });
                sendAsks(room, oldHolder);
            }
            return;
        }

        if (message.type === "drop_marker") {
            const room = requireAdmitted(connection);
            if (!room) {
                return;
            }
            if (room.markers[message.slot] !== sessionOf(connection).participantId) {
                sendError(connection.ws, "You are not holding that marker");
                return;
            }
            moveMarker(room, message.slot, null, [sessionOf(connection).participantId]);
            return;
        }

        if (message.type === "give_marker") {
            const room = requireAdmitted(connection);
            if (!room) {
                return;
            }
            if (room.markers[message.slot] !== sessionOf(connection).participantId) {
                sendError(connection.ws, "You are not holding that marker");
                return;
            }
            if (!room.admitted.has(message.toParticipantId)) {
                sendError(connection.ws, "They are not at the table");
                return;
            }
            moveMarker(room, message.slot, message.toParticipantId, [
                sessionOf(connection).participantId,
            ]);
            return;
        }

        if (message.type === "host_take_marker") {
            const room = requireHost(connection);
            if (!room) {
                return;
            }
            moveMarker(room, message.slot, sessionOf(connection).participantId);
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
            moveMarker(room, message.slot, message.toParticipantId);
            return;
        }

        if (message.type === "canvas") {
            const room = requireAdmitted(connection);
            if (!room) {
                return;
            }
            if (!holdsMarker(room, sessionOf(connection).participantId)) {
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
                    participantId: sessionOf(connection).participantId,
                    name: sessionOf(connection).name,
                    x: message.x,
                    y: message.y,
                    tool: message.tool ?? "laser",
                    button: message.button ?? "up",
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
            const seat = room.admitted.get(sessionOf(connection).participantId);
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
            try {
                sendJson(connection.ws, exportReplay(room));
            } catch {
                sendError(connection.ws, "Could not build that replay");
            }
        }
    });
}

const connections = new Set<Connection>();

wss.on("connection", (ws, request) => {
    const url = new URL(request.url ?? "/", "ws://localhost");
    const token = url.searchParams.get("token");
    const session = token ? readSession(token) : null;

    const connection: Connection = {
        ws,
        session,
        room: null,
        viaFormerSlug: false,
    };
    connections.add(connection);

    sendJson(ws, { type: "hello", authed: Boolean(session) });

    const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        }
    }, 20_000);

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
        clearInterval(heartbeat);
        connections.delete(connection);
        if (connection.room) {
            detachSocket(connection.room, ws);
        }
    });

    ws.on("error", (error) => {
        console.error("WebSocket error:", error);
    });
});

httpServer.listen(port, "0.0.0.0", () => {
    console.log(`WebSocket backend running on ${port}`);
    if (!process.env.DATABASE_URL) {
        console.error("DATABASE_URL is not set; joins will fail");
    }
    if (!process.env.JWT_SECRET) {
        console.error("JWT_SECRET is not set; using the default. HTTP and WS must match.");
    }
});

setInterval(() => {
    for (const room of liveRooms.values()) {
        if (isExpired(room)) {
            closeSitting(room);
        }
    }
}, 15_000);
