import { randomUUID } from "crypto";
import { REACTION_MIN_GAP_MS } from "@repo/common/constants";
import type { ClientMessage } from "@repo/common/types";
import type { Connection } from "../connection";
import {
    broadcastAdmitted,
    broadcastRoomState,
    readSession,
    requireAdmitted,
    requireHost,
    sendError,
    sendJson,
    sessionOf,
} from "../room-ops";

export async function handleMuteParticipant(connection: Connection, message: ClientMessage) {
    if (message.type !== "mute_participant") {
        return;
    }
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
}

/** The HTTP server re-issued this participant's token with a new name; carry it onto the live seat. */
export async function handleRename(connection: Connection, message: ClientMessage) {
    if (message.type !== "rename") {
        return;
    }
    const current = connection.session;
    const next = readSession(message.token);
    if (!current || !next || next.participantId !== current.participantId) {
        sendError(connection.ws, "That name change could not be checked");
        return;
    }
    connection.session = next;
    const room = connection.room;
    const seat = room?.admitted.get(next.participantId) ?? room?.waiting.get(next.participantId);
    if (!room || !seat || seat.ws !== connection.ws) {
        return;
    }
    seat.name = next.name;
    broadcastRoomState(room);
}

export async function handleSetMuted(connection: Connection, message: ClientMessage) {
    if (message.type !== "set_muted") {
        return;
    }
    const room = requireAdmitted(connection);
    if (!room) {
        return;
    }
    const seat = room.admitted.get(sessionOf(connection).participantId);
    if (seat) {
        seat.muted = message.muted;
        broadcastRoomState(room);
    }
}

export async function handleReact(connection: Connection, message: ClientMessage) {
    if (message.type !== "react") {
        return;
    }
    const room = requireAdmitted(connection);
    if (!room) {
        return;
    }
    const seat = room.admitted.get(sessionOf(connection).participantId);
    if (!seat) {
        return;
    }
    const now = Date.now();
    if (now - seat.reactedAt < REACTION_MIN_GAP_MS) {
        return;
    }
    seat.reactedAt = now;
    seat.activeAt = now;
    broadcastAdmitted(room, {
        type: "reaction",
        id: randomUUID(),
        participantId: seat.participantId,
        emoji: message.emoji,
    });
}
