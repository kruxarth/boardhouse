import { REPLAY_MIN_GAP_MS } from "@repo/common/constants";
import type { ClientMessage } from "@repo/common/types";
import type { Connection } from "../connection";
import {
    broadcastAdmitted,
    requireAdmitted,
    sendError,
    sendJson,
    sessionOf,
    touchSeat,
} from "../room-ops";
import { appendReplay, exportReplay, holdsMarker, mergeCanvas } from "../store";

export async function handleCanvas(connection: Connection, message: ClientMessage) {
    if (message.type !== "canvas") {
        return;
    }
    const room = requireAdmitted(connection);
    if (!room) {
        return;
    }
    if (!holdsMarker(room, sessionOf(connection).participantId)) {
        sendError(connection.ws, "Only marker holders can draw");
        return;
    }
    touchSeat(room, sessionOf(connection).participantId);
    const merged = mergeCanvas(room.canvas, message.payload);
    room.canvas = merged;
    room.canvasDirty = true;
    appendReplay(room, "canvas", merged);
    broadcastAdmitted(room, { type: "canvas", payload: message.payload }, connection.ws);
    sendJson(connection.ws, { type: "canvas_ack" });
}

export async function handleCursor(connection: Connection, message: ClientMessage) {
    if (message.type !== "cursor") {
        return;
    }
    const room = requireAdmitted(connection);
    if (!room) {
        return;
    }
    touchSeat(room, sessionOf(connection).participantId);
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
}

export async function handleGetReplay(connection: Connection, message: ClientMessage) {
    if (message.type !== "get_replay") {
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
    if (now - seat.replayedAt < REPLAY_MIN_GAP_MS) {
        return;
    }
    seat.replayedAt = now;
    try {
        sendJson(connection.ws, exportReplay(room));
    } catch {
        sendError(connection.ws, "Could not build that replay");
    }
}
