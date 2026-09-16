import { randomBytes, randomUUID } from "crypto";
import { MAX_ROOMS, ROOM_TTL_MS } from "@repo/common/constants";
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

export async function wipeExpiredRooms() {
    const expired = await prismaClient.room.findMany({
        where: { expiresAt: { lte: new Date() } },
        select: { id: true, slug: true, formerSlugs: true },
    });

    for (const room of expired) {
        await deleteLivekitRoom(room.slug);
        for (const former of room.formerSlugs) {
            await deleteLivekitRoom(former);
        }
        await prismaClient.room.delete({ where: { id: room.id } });
    }

    return expired.length;
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
        },
    });
    return rooms;
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
