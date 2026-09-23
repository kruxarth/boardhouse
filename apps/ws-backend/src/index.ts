import { createServer } from "http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { MAX_CANVAS_MESSAGE_BYTES } from "@repo/common/constants";
import { ClientMessageSchema } from "@repo/common/types";
import { Prisma, prismaClient } from "@repo/db";
import { clearAuthTimeout, type Connection } from "./connection";
import { handlers } from "./handlers";
import { enqueueRoomEvent } from "./queue";
import {
    closeSitting,
    detachSocket,
    markTableEmpty,
    markTableOccupied,
    readSession,
    sendError,
    sendJson,
    sweepLapsedAsks,
} from "./room-ops";
import { getLiveRoom, isExpired, liveRooms } from "./store";

const port = Number(process.env.PORT) || 8081;
const AUTH_TIMEOUT_MS = 10_000;
const CANVAS_SAVE_MS = 5_000;

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
    maxPayload: MAX_CANVAS_MESSAGE_BYTES,
});

type AliveSocket = WebSocket & { isAlive?: boolean };

function byteLength(data: RawData) {
    if (Array.isArray(data)) {
        return data.reduce((total, chunk) => total + chunk.length, 0);
    }
    if (Buffer.isBuffer(data)) {
        return data.length;
    }
    return data.byteLength;
}

async function handleMessage(connection: Connection, data: RawData) {
    if (byteLength(data) > MAX_CANVAS_MESSAGE_BYTES) {
        sendError(connection.ws, "Message too large");
        connection.ws.close(1009, "message too large");
        return;
    }

    const raw = data.toString();
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
    const handler = handlers[message.type];

    if (message.type === "join") {
        await handler(connection, message);
        return;
    }

    if (!connection.session) {
        sendJson(connection.ws, { type: "auth_error", message: "Invalid token" });
        return;
    }

    if (message.type === "leave" || message.type === "knock") {
        await handler(connection, message);
        return;
    }

    const roomId = connection.room?.id;
    if (!roomId) {
        sendError(connection.ws, "Join a table first");
        return;
    }

    await enqueueRoomEvent(roomId, async () => {
        await handler(connection, message);
    });
}

const connections = new Set<Connection>();

wss.on("connection", (ws, request) => {
    const alive = ws as AliveSocket;
    alive.isAlive = true;
    ws.on("pong", () => {
        alive.isAlive = true;
    });

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

    if (!session) {
        connection.authTimer = setTimeout(() => {
            if (!connection.session && ws.readyState === WebSocket.OPEN) {
                ws.close(4008, "authenticate");
            }
        }, AUTH_TIMEOUT_MS);
    }

    sendJson(ws, { type: "hello", authed: Boolean(session) });

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
        clearAuthTimeout(connection);
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
    for (const client of wss.clients) {
        const ws = client as AliveSocket;
        if (ws.readyState !== WebSocket.OPEN) {
            continue;
        }
        if (ws.isAlive === false) {
            ws.terminate();
            continue;
        }
        ws.isAlive = false;
        ws.ping();
    }
}, 20_000);

async function persistDirtyCanvases() {
    for (const room of [...liveRooms.values()]) {
        if (!room.canvasDirty) {
            continue;
        }
        const snapshot = room.canvas;
        room.canvasDirty = false;
        try {
            await prismaClient.room.update({
                where: { id: room.id },
                data: {
                    canvas: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
                },
            });
            const live = getLiveRoom(room.id);
            if (live && live.canvas !== snapshot) {
                live.canvasDirty = true;
            }
        } catch (error) {
            console.error("Error saving canvas:", error);
            const live = getLiveRoom(room.id);
            if (live) {
                live.canvasDirty = true;
            }
        }
    }
}

/** A restart drops every socket, so seat counts and "someone is here" flags in Postgres are stale. */
async function releaseStaleSeats() {
    await prismaClient.room.updateMany({
        where: {
            expiresAt: { gt: new Date() },
            OR: [{ seated: { gt: 0 } }, { emptySince: null }],
        },
        data: { seated: 0, emptySince: new Date() },
    });
}

releaseStaleSeats()
    .catch((error) => {
        console.error("Error clearing seats after restart:", error);
    })
    .finally(() => {
        httpServer.listen(port, "0.0.0.0", () => {
            console.log(`WebSocket backend running on ${port}`);
            if (!process.env.DATABASE_URL) {
                console.error("DATABASE_URL is not set; joins will fail");
            }
            if (process.env.NODE_ENV !== "production" && !process.env.JWT_SECRET) {
                console.error("JWT_SECRET is not set; using the development default. HTTP and WS must match.");
            }
        });
    });

setInterval(() => {
    void persistDirtyCanvases();
}, CANVAS_SAVE_MS);

setInterval(() => {
    void (async () => {
        for (const room of [...liveRooms.values()]) {
            if (isExpired(room)) {
                closeSitting(room);
                continue;
            }
            if (room.admitted.size === 0) {
                markTableEmpty(room);
            } else {
                markTableOccupied(room);
            }
            try {
                const row = await prismaClient.room.findUnique({
                    where: { id: room.id },
                    select: { hostKey: true },
                });
                if (!row) {
                    closeSitting(room);
                    continue;
                }
                if (row.hostKey !== room.hostKey) {
                    closeSitting(room, "This table was claimed");
                }
            } catch {
                // Next tick retries.
            }
        }
    })();
}, 15_000);

setInterval(() => {
    for (const room of liveRooms.values()) {
        if (room.asks.size === 0) {
            continue;
        }
        void enqueueRoomEvent(room.id, async () => {
            sweepLapsedAsks(room);
        });
    }
}, 1_000);
