import { randomBytes, randomUUID } from "crypto";
import { EMPTY_TABLE_MS, MAX_ROOMS, ROOM_TTL_MS } from "@repo/common/constants";
import { prismaClient } from "@repo/db";
import { deleteLivekitRoom } from "./livekit";

export function makeGuestSlug(name?: string) {
    const base = (name ?? "table")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 24) || "table";
    return `${base}-${randomUUID().slice(0, 8)}`;
}

export function makeHostKey() {
    return randomBytes(18).toString("base64url");
}

export function unusedCutoff(now = new Date()) {
    return new Date(now.getTime() - EMPTY_TABLE_MS);
}

export function isUnusedTable(emptySince: Date | null, now = new Date()) {
    return emptySince !== null && emptySince.getTime() <= unusedCutoff(now).getTime();
}

export async function wipeExpiredRooms() {
    const now = new Date();
    const stale = await prismaClient.room.findMany({
        where: { expiresAt: { lte: now } },
        select: { id: true, slug: true, formerSlugs: true },
    });

    let wiped = 0;
    for (const room of stale) {
        const gone = await prismaClient.room.deleteMany({
            where: { id: room.id, expiresAt: { lte: now } },
        });
        if (gone.count === 0) {
            continue;
        }
        wiped += 1;
        await deleteLivekitRoom(room.slug);
        for (const former of room.formerSlugs) {
            await deleteLivekitRoom(former);
        }
    }

    return wiped;
}

export async function occupancyCount() {
    await wipeExpiredRooms();
    return prismaClient.room.count({
        where: { expiresAt: { gt: new Date() } },
    });
}

export async function listHouseTables() {
    await wipeExpiredRooms();
    const rooms = await prismaClient.room.findMany({
        where: { expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "asc" },
        select: {
            slug: true,
            name: true,
            hostName: true,
            expiresAt: true,
            emptySince: true,
        },
    });
    return rooms;
}

export function houseOccupancy(
    rooms: Awaited<ReturnType<typeof listHouseTables>>
) {
    const occupied = rooms.map((room) => ({
        empty: false as const,
        unused: isUnusedTable(room.emptySince),
        slug: room.slug,
        name: room.name,
        hostName: room.hostName.trim() || "Someone",
        expiresAt: room.expiresAt.toISOString(),
    }));
    return {
        used: occupied.length,
        max: MAX_ROOMS,
        tables: [
            ...occupied,
            ...Array.from({ length: Math.max(0, MAX_ROOMS - occupied.length) }, () => ({
                empty: true as const,
            })),
        ],
    };
}

export async function assertHouseHasATable() {
    const used = await occupancyCount();
    if (used >= MAX_ROOMS) {
        return { ok: false as const, used };
    }
    return { ok: true as const, used };
}

export function roomExpiryDate(from = new Date()) {
    return new Date(from.getTime() + ROOM_TTL_MS);
}

export async function findRoomBySlug(slug: string) {
    return prismaClient.room.findFirst({
        where: {
            OR: [{ slug }, { formerSlugs: { has: slug } }],
        },
    });
}

export async function claimUnusedRoom(options: {
    slug: string;
    participantId: string;
    hostName: string;
    name: string;
}) {
    await wipeExpiredRooms();
    const room = await findRoomBySlug(options.slug);
    if (!room) {
        return { ok: false as const, reason: "missing" as const };
    }
    if (room.expiresAt.getTime() <= Date.now()) {
        return { ok: false as const, reason: "expired" as const };
    }
    if (!isUnusedTable(room.emptySince)) {
        return { ok: false as const, reason: "in_use" as const };
    }

    const slug = makeGuestSlug(options.name);
    const hostKey = makeHostKey();
    const now = new Date();
    const formerSlugs = [...new Set([room.slug, ...room.formerSlugs])];

    const taken = await prismaClient.room.updateMany({
        where: {
            id: room.id,
            expiresAt: { gt: now },
            emptySince: { lte: unusedCutoff(now) },
        },
        data: {
            slug,
            hostKey,
            hostParticipantId: options.participantId,
            hostName: options.hostName,
            accessMode: "knock",
            name: options.name,
            formerSlugs,
            emptySince: now,
        },
    });

    if (taken.count === 0) {
        return { ok: false as const, reason: "in_use" as const };
    }

    await deleteLivekitRoom(room.slug);
    for (const former of room.formerSlugs) {
        await deleteLivekitRoom(former);
    }

    return {
        ok: true as const,
        slug,
        hostKey,
        name: options.name,
        accessMode: "knock" as const,
        expiresAt: room.expiresAt,
        formerSlugs,
    };
}
