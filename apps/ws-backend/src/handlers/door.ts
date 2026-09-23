import { randomUUID } from "crypto";
import { KNOCK_COOLDOWN_MS } from "@repo/common/constants";
import type { ClientMessage } from "@repo/common/types";
import { prismaClient } from "@repo/db";
import type { Connection } from "../connection";
import { enqueueRoomEvent } from "../queue";
import {
    admit,
    authenticate,
    broadcastAdmitted,
    broadcastRoomState,
    closeSitting,
    detachSocket,
    hostKeyMatches,
    isHost,
    loadRoom,
    putInWaiting,
    reclaimHost,
    requireHost,
    sendError,
    sendJson,
    sessionOf,
    wipeSitting,
} from "../room-ops";
import { guestSeatOpen, hostSeatOpen, isExpired } from "../store";

export async function handleJoin(connection: Connection, message: ClientMessage) {
    if (message.type !== "join") {
        return;
    }
    const session = authenticate(connection, message.token);
    if (!session) {
        return;
    }

    let loaded: Awaited<ReturnType<typeof loadRoom>>;
    try {
        loaded = await loadRoom(message.roomId);
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
    const fromHouse = message.fromHouse === true;
    const hostKey = message.hostKey;
    await enqueueRoomEvent(live.id, async () => {
        if (isExpired(live)) {
            closeSitting(live);
            sendJson(connection.ws, { type: "expired", message: "This sitting is over" });
            return;
        }

        const validHostKey = hostKeyMatches(hostKey, live);
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

export async function handleLeave(connection: Connection, message: ClientMessage) {
    if (message.type !== "leave") {
        return;
    }
    if (connection.room) {
        detachSocket(connection.room, connection.ws);
        connection.room = null;
    }
    sendJson(connection.ws, { type: "left" });
}

export async function handleKnock(connection: Connection, message: ClientMessage) {
    if (message.type !== "knock") {
        return;
    }
    const room = connection.room;
    if (!room || !room.waiting.has(sessionOf(connection).participantId)) {
        sendError(connection.ws, "You are not waiting at this door");
        return;
    }
    const seat = room.waiting.get(sessionOf(connection).participantId);
    if (seat && seat.lastKnockAt) {
        const wait = KNOCK_COOLDOWN_MS - (Date.now() - seat.lastKnockAt);
        if (wait > 0) {
            sendError(connection.ws, "Give them a moment");
            return;
        }
    }
    if (seat) {
        seat.lastKnockAt = Date.now();
    }
    const host = room.admitted.get(room.hostParticipantId);
    if (seat && host) {
        sendJson(host.ws, { type: "knock", participant: {
            id: seat.participantId,
            name: seat.name,
            muted: seat.muted,
            avatar: Number.isInteger(seat.avatar) ? seat.avatar : 0,
        } });
    }
}

export async function handleAdmit(connection: Connection, message: ClientMessage) {
    if (message.type !== "admit") {
        return;
    }
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
}

export async function handleDeny(connection: Connection, message: ClientMessage) {
    if (message.type !== "deny") {
        return;
    }
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
}

export async function handleSetMode(connection: Connection, message: ClientMessage) {
    if (message.type !== "set_mode") {
        return;
    }
    const room = requireHost(connection);
    if (!room) {
        return;
    }
    await prismaClient.room.update({
        where: { id: room.id },
        data: { accessMode: message.accessMode },
    });
    room.accessMode = message.accessMode;
    broadcastRoomState(room);
}

export async function handleRotateSlug(connection: Connection, message: ClientMessage) {
    if (message.type !== "rotate_slug") {
        return;
    }
    const room = requireHost(connection);
    if (!room) {
        return;
    }
    const oldSlug = room.slug;
    const nextSlug = `table-${randomUUID().slice(0, 8)}`;
    const formerSlugs = new Set(room.formerSlugs);
    formerSlugs.add(oldSlug);
    await prismaClient.room.update({
        where: { id: room.id },
        data: {
            slug: nextSlug,
            formerSlugs: [...formerSlugs],
        },
    });
    room.formerSlugs = formerSlugs;
    room.slug = nextSlug;
    broadcastAdmitted(room, {
        type: "slug_rotated",
        slug: nextSlug,
        formerSlug: oldSlug,
    });
    broadcastRoomState(room);
}

export async function handleEndRoom(connection: Connection, message: ClientMessage) {
    if (message.type !== "end_room") {
        return;
    }
    const room = requireHost(connection);
    if (!room) {
        return;
    }
    await wipeSitting(room, "The host ended this sitting");
}
