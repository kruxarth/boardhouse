import type { ClientMessage } from "@repo/common/types";
import type { Connection } from "../connection";
import {
    moveMarker,
    requireAdmitted,
    requireHost,
    sendAsks,
    sendError,
    sendJson,
    sendPendingAsk,
    sessionOf,
    settleAsk,
    touchSeat,
} from "../room-ops";
import { cooldownLeft, holderIsAway, newAsk, pendingAskFrom } from "../store";

export async function handleTakeMarker(connection: Connection, message: ClientMessage) {
    if (message.type !== "take_marker") {
        return;
    }
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
}

export async function handleAskMarker(connection: Connection, message: ClientMessage) {
    if (message.type !== "ask_marker") {
        return;
    }
    const room = requireAdmitted(connection);
    if (!room) {
        return;
    }
    const me = sessionOf(connection).participantId;
    const slot = message.slot;
    const holderId = room.markers[slot];
    if (!holderId) {
        sendError(connection.ws, "Nobody is holding that marker");
        return;
    }
    if (holderId === me) {
        sendError(connection.ws, "You already have that marker");
        return;
    }
    if (pendingAskFrom(room, me)) {
        sendError(connection.ws, "You already have an ask out");
        return;
    }
    if (cooldownLeft(room, me, slot) > 0) {
        sendError(connection.ws, "Give them a moment");
        return;
    }
    if (holderIsAway(room, holderId)) {
        moveMarker(room, slot, me, [holderId]);
        sendJson(connection.ws, { type: "marker_ask_done", slot, outcome: "given" });
        return;
    }
    const ask = newAsk(me, holderId, slot);
    room.asks.set(ask.requestId, ask);
    sendAsks(room, holderId);
    sendPendingAsk(room, me);
}

export async function handleCancelAsk(connection: Connection, message: ClientMessage) {
    if (message.type !== "cancel_ask") {
        return;
    }
    const room = requireAdmitted(connection);
    if (!room) {
        return;
    }
    const me = sessionOf(connection).participantId;
    const ask = pendingAskFrom(room, me);
    if (!ask) {
        return;
    }
    room.asks.delete(ask.requestId);
    sendAsks(room, ask.holderId);
    sendPendingAsk(room, me);
}

export async function handleAnswerMarker(connection: Connection, message: ClientMessage) {
    if (message.type !== "answer_marker") {
        return;
    }
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
    touchSeat(room, sessionOf(connection).participantId);
    const asker = room.admitted.get(ask.fromParticipantId);
    const oldHolder = ask.holderId;
    if (message.give && room.markers[ask.slot] === ask.holderId && asker) {
        moveMarker(room, ask.slot, ask.fromParticipantId, [oldHolder]);
        settleAsk(room, ask, "given");
    } else {
        settleAsk(room, ask, "kept");
        sendAsks(room, oldHolder);
    }
}

export async function handleDropMarker(connection: Connection, message: ClientMessage) {
    if (message.type !== "drop_marker") {
        return;
    }
    const room = requireAdmitted(connection);
    if (!room) {
        return;
    }
    if (room.markers[message.slot] !== sessionOf(connection).participantId) {
        sendError(connection.ws, "You are not holding that marker");
        return;
    }
    moveMarker(room, message.slot, null, [sessionOf(connection).participantId]);
}

export async function handleGiveMarker(connection: Connection, message: ClientMessage) {
    if (message.type !== "give_marker") {
        return;
    }
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
    moveMarker(room, message.slot, message.toParticipantId, [sessionOf(connection).participantId]);
}

export async function handleHostTakeMarker(connection: Connection, message: ClientMessage) {
    if (message.type !== "host_take_marker") {
        return;
    }
    const room = requireHost(connection);
    if (!room) {
        return;
    }
    moveMarker(room, message.slot, sessionOf(connection).participantId);
}

export async function handleHostGiveMarker(connection: Connection, message: ClientMessage) {
    if (message.type !== "host_give_marker") {
        return;
    }
    const room = requireHost(connection);
    if (!room) {
        return;
    }
    if (!room.admitted.has(message.toParticipantId)) {
        sendError(connection.ws, "They are not at the table");
        return;
    }
    moveMarker(room, message.slot, message.toParticipantId);
}
