import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { JWT_SECRET } from "@repo/backend-common/config";
import { MAX_ROOMS, SESSION_TTL } from "@repo/common/constants";
import { CreateRoomSchema, CreateSessionSchema } from "@repo/common/types";
import { prismaClient } from "@repo/db";
import { middleware } from "./middleware";
import { livekitConfigured, mintLivekitToken } from "./livekit";
import {
    assertHouseHasATable,
    findRoomBySlug,
    listHouseTables,
    makeGuestSlug,
    makeHostKey,
    roomExpiryDate,
    wipeExpiredRooms,
} from "./rooms";

const app = express();
app.use(cors({ origin: "http://localhost:3000" }));
app.use(express.json());

const WIPE_MS = 30_000;
setInterval(() => {
    void wipeExpiredRooms().catch((error) => {
        console.error("Error wiping expired rooms:", error);
    });
}, WIPE_MS);
void wipeExpiredRooms();

app.post("/session", async (req, res) => {
    const parsed = CreateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: "Name must be 2–24 characters" });
    }

    const participantId = randomUUID();
    const token = jwt.sign(
        { sub: participantId, name: parsed.data.name },
        JWT_SECRET,
        { expiresIn: SESSION_TTL }
    );

    return res.status(201).json({
        token,
        participantId,
        name: parsed.data.name,
    });
});

app.get("/occupancy", async (_req, res) => {
    try {
        const rooms = await listHouseTables();
        const occupied = rooms.map((room) => ({
            empty: false as const,
            slug: room.slug,
            name: room.name,
            hostName: room.hostName.trim() || "Someone",
            expiresAt: room.expiresAt.toISOString(),
        }));
        const tables = [
            ...occupied,
            ...Array.from({ length: Math.max(0, MAX_ROOMS - occupied.length) }, () => ({
                empty: true as const,
            })),
        ];
        return res.json({ used: occupied.length, max: MAX_ROOMS, tables });
    } catch (error) {
        console.error("Error reading occupancy:", error);
        return res.status(500).json({ message: "Could not read occupancy" });
    }
});

app.post("/rooms", middleware, async (req, res) => {
    if (!req.participantId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const parsed = CreateRoomSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input" });
    }

    try {
        const house = await assertHouseHasATable();
        if (!house.ok) {
            return res.status(503).json({
                message: "House is full",
                occupancy: { used: house.used, max: MAX_ROOMS },
            });
        }

        const slug = makeGuestSlug(parsed.data.name);
        const hostKey = makeHostKey();
        const expiresAt = roomExpiryDate();

        const room = await prismaClient.room.create({
            data: {
                slug,
                hostKey,
                hostParticipantId: req.participantId,
                hostName: req.participantName ?? "",
                accessMode: "knock",
                name: parsed.data.name ?? null,
                expiresAt,
            },
        });

        return res.status(201).json({
            slug: room.slug,
            hostKey: room.hostKey,
            name: room.name,
            accessMode: room.accessMode,
            expiresAt: room.expiresAt.toISOString(),
            guestPath: `/room/${room.slug}`,
            hostPath: `/room/${room.slug}?host=${room.hostKey}`,
            occupancy: { used: house.used + 1, max: MAX_ROOMS },
        });
    } catch (error) {
        console.error("Error creating room:", error);
        return res.status(500).json({ message: "Could not open a table" });
    }
});

app.get("/rooms/:slug", async (req, res) => {
    const slug = req.params.slug;
    if (!slug) {
        return res.status(400).json({ message: "Missing slug" });
    }

    try {
        await wipeExpiredRooms();
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

app.listen(8080, () => {
    console.log("HTTP backend running on http://localhost:8080");
});
