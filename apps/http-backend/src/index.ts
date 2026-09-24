import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { JWT_SECRET } from "@repo/backend-common/config";
import { livekitConfigured, mintLivekitToken } from "@repo/backend-common/livekit";
import { MAX_ROOMS, SESSION_TTL_SECONDS } from "@repo/common/constants";
import { ClaimRoomSchema, CreateRoomSchema, CreateSessionSchema } from "@repo/common/types";
import { middleware } from "./middleware";
import {
    claimUnusedRoom,
    findRoomBySlug,
    houseOccupancy,
    listHouseTables,
    openHouseTable,
    wipeExpiredRooms,
} from "./rooms";

function allowedOrigins() {
    const extra = (process.env.FRONTEND_URL ?? "")
        .split(",")
        .map((origin) => origin.trim().replace(/\/$/, ""))
        .filter(Boolean);
    return [
        ...new Set([
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "https://board-house.vercel.app",
            ...extra,
        ]),
    ];
}

function isAllowedOrigin(origin: string | undefined) {
    if (!origin) {
        return true;
    }
    if (allowedOrigins().includes(origin)) {
        return true;
    }
    try {
        const host = new URL(origin).hostname;
        return host === "board-house.vercel.app" || isTeamPreview(host);
    } catch {
        return false;
    }
}

function isTeamPreview(hostname: string) {
    const team = (process.env.VERCEL_TEAM_SLUG ?? "").trim().toLowerCase();
    if (!team || !/^[a-z0-9-]+$/.test(team)) {
        return false;
    }
    const suffix = `-${team}.vercel.app`;
    if (!hostname.endsWith(suffix) || !hostname.startsWith("board-house-")) {
        return false;
    }
    const middle = hostname.slice("board-house-".length, hostname.length - suffix.length);
    return middle.length > 0;
}

function routeSlug(value: string | string[] | undefined) {
    return typeof value === "string" ? value : "";
}

const sessionLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests" },
});

const roomLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests" },
});

const app = express();
if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}
app.use(
    cors({
        origin(origin, callback) {
            callback(null, isAllowedOrigin(origin));
        },
    })
);
app.use(express.json());

app.get("/health", (_req, res) => {
    res.status(200).send("ok");
});

const WIPE_MS = 30_000;
setInterval(() => {
    void wipeExpiredRooms().catch((error) => {
        console.error("Error wiping expired rooms:", error);
    });
}, WIPE_MS);
void wipeExpiredRooms();

function issueSession(participantId: string, name: string) {
    const token = jwt.sign(
        { sub: participantId, name },
        JWT_SECRET,
        { expiresIn: SESSION_TTL_SECONDS }
    );
    return { token, participantId, name };
}

app.post("/session", sessionLimiter, async (req, res) => {
    const parsed = CreateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: "Name must be 2–24 characters" });
    }

    return res.status(201).json(issueSession(randomUUID(), parsed.data.name));
});

app.post("/session/refresh", middleware, (req, res) => {
    if (!req.participantId || !req.participantName) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    return res.json(issueSession(req.participantId, req.participantName));
});

app.get("/occupancy", async (_req, res) => {
    try {
        const rooms = await listHouseTables();
        return res.json(houseOccupancy(rooms));
    } catch (error) {
        console.error("Error reading occupancy:", error);
        return res.status(500).json({ message: "Could not read occupancy" });
    }
});

app.post("/rooms", roomLimiter, middleware, async (req, res) => {
    if (!req.participantId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const parsed = CreateRoomSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: "Name this sitting" });
    }

    try {
        const opened = await openHouseTable({
            participantId: req.participantId,
            hostName: req.participantName ?? "",
            name: parsed.data.name,
        });
        if (!opened.ok) {
            return res.status(503).json({
                message: "House is full",
                occupancy: { used: opened.used, max: MAX_ROOMS },
            });
        }

        const room = opened.room;
        return res.status(201).json({
            slug: room.slug,
            hostKey: room.hostKey,
            name: room.name,
            accessMode: room.accessMode,
            expiresAt: room.expiresAt.toISOString(),
            guestPath: `/room/${room.slug}`,
            hostPath: `/room/${room.slug}?host=${room.hostKey}`,
            occupancy: { used: opened.used + 1, max: MAX_ROOMS },
        });
    } catch (error) {
        console.error("Error creating room:", error);
        return res.status(500).json({ message: "Could not open a table" });
    }
});

app.post("/rooms/:slug/claim", roomLimiter, middleware, async (req, res) => {
    if (!req.participantId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const slug = routeSlug(req.params.slug);
    if (!slug) {
        return res.status(400).json({ message: "Missing slug" });
    }

    const parsed = ClaimRoomSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: "Name this sitting" });
    }

    try {
        const claimed = await claimUnusedRoom({
            slug,
            participantId: req.participantId,
            hostName: req.participantName ?? "",
            name: parsed.data.name,
        });

        if (!claimed.ok) {
            if (claimed.reason === "missing") {
                return res.status(404).json({ message: "No table at this door" });
            }
            if (claimed.reason === "expired") {
                return res.status(410).json({ message: "This sitting is over" });
            }
            const rooms = await listHouseTables();
            return res.status(409).json({
                message: "That table is no longer unused",
                occupancy: houseOccupancy(rooms),
            });
        }

        const rooms = await listHouseTables();
        return res.json({
            slug: claimed.slug,
            hostKey: claimed.hostKey,
            name: claimed.name,
            accessMode: claimed.accessMode,
            expiresAt: claimed.expiresAt.toISOString(),
            guestPath: `/room/${claimed.slug}`,
            hostPath: `/room/${claimed.slug}?host=${claimed.hostKey}`,
            occupancy: houseOccupancy(rooms),
        });
    } catch (error) {
        console.error("Error claiming room:", error);
        return res.status(500).json({ message: "Could not claim this table" });
    }
});

app.get("/rooms/:slug", async (req, res) => {
    const slug = routeSlug(req.params.slug);
    if (!slug) {
        return res.status(400).json({ message: "Missing slug" });
    }

    try {
        const room = await findRoomBySlug(slug);
        if (!room) {
            return res.status(404).json({ message: "No table at this door" });
        }

        if (room.expiresAt.getTime() <= Date.now()) {
            return res.status(410).json({ message: "This sitting is over" });
        }

        return res.json({
            slug: room.slug,
            requestedSlug: slug,
            viaFormerSlug: room.slug !== slug,
            name: room.name,
            accessMode: room.accessMode,
            expiresAt: room.expiresAt.toISOString(),
            hostParticipantId: room.hostParticipantId,
        });
    } catch (error) {
        console.error("Error fetching room:", error);
        return res.status(500).json({ message: "Could not open this door" });
    }
});

app.get("/livekit-token", middleware, async (req, res) => {
    if (!req.participantId || !req.participantName) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    if (!livekitConfigured()) {
        return res.status(503).json({
            configured: false,
            message: "Voice not configured",
        });
    }

    const slug = typeof req.query.room === "string" ? req.query.room : "";
    if (!slug) {
        return res.status(400).json({ message: "Missing room" });
    }

    const room = await findRoomBySlug(slug);
    if (!room) {
        return res.status(404).json({ message: "No table at this door" });
    }
    if (room.expiresAt.getTime() <= Date.now()) {
        return res.status(410).json({ message: "This sitting is over" });
    }

    try {
        const minted = await mintLivekitToken({
            identity: req.participantId,
            name: req.participantName,
            slug: room.slug,
        });
        if (!minted) {
            return res.status(503).json({
                configured: false,
                message: "Voice not configured",
            });
        }
        return res.json({
            configured: true,
            token: minted.token,
            url: minted.url,
        });
    } catch (error) {
        console.error("Error minting LiveKit token:", error);
        return res.status(500).json({ message: "Could not start voice" });
    }
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, "0.0.0.0", () => {
    console.log(`HTTP backend running on ${port}`);
});
