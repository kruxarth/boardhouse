import { describe, expect, it } from "vitest";
import { HOLDER_IDLE_MS, MAX_REPLAY_BYTES, MAX_REPLAY_EVENTS, MAX_SEATS } from "@repo/common/constants";
import {
    guestSeatOpen,
    holderIsAway,
    mergeCanvas,
    retargetAsks,
    trimReplay,
    type LiveRoom,
    type MarkerAsk,
    type Seat,
} from "./store";

function seat(id: string, activeAt = Date.now()): Seat {
    return {
        ws: {} as Seat["ws"],
        participantId: id,
        name: id,
        muted: true,
        admitted: true,
        avatar: 0,
        activeAt,
        reactedAt: 0,
        replayedAt: 0,
    };
}

function room(partial: Partial<LiveRoom> = {}): LiveRoom {
    return {
        id: "room",
        slug: "table",
        formerSlugs: new Set(),
        hostKey: "host-key",
        hostParticipantId: "host",
        accessMode: "knock",
        name: "sitting",
        expiresAt: Date.now() + 60_000,
        startedAt: Date.now(),
        emptySince: null,
        admitted: new Map(),
        waiting: new Map(),
        markers: ["host", null],
        asks: new Map(),
        askCooldowns: new Map(),
        avatarOrder: [],
        avatars: new Map(),
        canvas: { elements: [], files: {} },
        canvasDirty: false,
        replay: [],
        replayBytes: 0,
        markerGrace: new Map(),
        seatedPersisted: -1,
        ...partial,
    };
}

function ask(partial: Partial<MarkerAsk> & Pick<MarkerAsk, "fromParticipantId" | "holderId" | "slot">): MarkerAsk {
    return {
        requestId: partial.requestId ?? `${partial.fromParticipantId}-${partial.slot}`,
        expiresAt: partial.expiresAt ?? Date.now() + 9_000,
        ...partial,
    };
}

describe("retargetAsks", () => {
    it("moves other asks onto the new holder and answers the new holder's own ask", () => {
        const live = room();
        const own = ask({ requestId: "own", fromParticipantId: "next", holderId: "old", slot: 0 });
        const other = ask({ requestId: "other", fromParticipantId: "guest", holderId: "old", slot: 0 });
        const otherSlot = ask({ requestId: "pen", fromParticipantId: "guest", holderId: "old", slot: 1 });
        live.asks.set(own.requestId, own);
        live.asks.set(other.requestId, other);
        live.asks.set(otherSlot.requestId, otherSlot);
        const before = other.expiresAt;

        const answered = retargetAsks(live, 0, "next");

        expect(answered.map((item) => item.requestId)).toEqual(["own"]);
        expect(live.asks.has("own")).toBe(false);
        expect(live.asks.get("other")?.holderId).toBe("next");
        expect(live.asks.get("other")?.expiresAt).toBeGreaterThanOrEqual(before);
        expect(live.asks.get("pen")?.holderId).toBe("old");
    });
});

describe("holderIsAway", () => {
    it("treats a missing holder as away and an idle holder as away", () => {
        const live = room();
        expect(holderIsAway(live, "missing")).toBe(true);

        live.admitted.set("host", seat("host", Date.now()));
        expect(holderIsAway(live, "host")).toBe(false);

        live.admitted.set("host", seat("host", Date.now() - HOLDER_IDLE_MS));
        expect(holderIsAway(live, "host")).toBe(true);
    });
});

describe("guestSeatOpen", () => {
    it("reserves a seat for the host when they are not sitting", () => {
        const live = room();
        expect(guestSeatOpen(live)).toBe(true);

        for (let i = 0; i < MAX_SEATS - 1; i += 1) {
            live.admitted.set(`guest-${i}`, seat(`guest-${i}`));
        }
        expect(guestSeatOpen(live)).toBe(false);

        live.admitted.set("host", seat("host"));
        expect(live.admitted.size).toBe(MAX_SEATS);
        expect(guestSeatOpen(live)).toBe(false);

        live.admitted.delete(`guest-${MAX_SEATS - 2}`);
        expect(guestSeatOpen(live)).toBe(true);
    });
});

describe("trimReplay", () => {
    it("drops frames until the event cap and the byte cap both hold", () => {
        const live = room();
        for (let i = 0; i < MAX_REPLAY_EVENTS + 30; i += 1) {
            const event = { t: i * 10_000, type: "cursor", payload: { i } };
            live.replay.push(event);
            live.replayBytes += JSON.stringify(event).length;
        }

        trimReplay(live);

        expect(live.replay.length).toBeLessThanOrEqual(MAX_REPLAY_EVENTS);
        expect(live.replay.length).toBeGreaterThan(0);
        expect(live.replayBytes).toBeLessThanOrEqual(MAX_REPLAY_BYTES);
    });

    it("shrinks a buffer whose payloads exceed the byte cap", () => {
        const live = room();
        const payload = "x".repeat(50_000);
        for (let i = 0; i < 100; i += 1) {
            const event = { t: i * 10_000, type: "canvas", payload };
            live.replay.push(event);
            live.replayBytes += JSON.stringify(event).length;
        }

        trimReplay(live);

        expect(live.replayBytes).toBeLessThanOrEqual(MAX_REPLAY_BYTES);
        expect(live.replay.length).toBeLessThan(100);
    });
});

describe("mergeCanvas", () => {
    it("keeps the higher version of each element and unions files", () => {
        const current = {
            elements: [
                { id: "a", version: 1, index: "a0" },
                { id: "b", version: 4, index: "a1" },
            ],
            files: { old: { id: "old" } },
        };
        const incoming = {
            elements: [
                { id: "a", version: 3, index: "a0" },
                { id: "b", version: 2, index: "a1" },
                { id: "c", version: 1, index: "a2" },
            ],
            files: { next: { id: "next" } },
        };

        const merged = mergeCanvas(current, incoming);
        const versions = new Map(
            merged.elements.map((element) => {
                const row = element as { id: string; version: number };
                return [row.id, row.version];
            })
        );

        expect(versions.get("a")).toBe(3);
        expect(versions.get("b")).toBe(4);
        expect(versions.get("c")).toBe(1);
        expect(Object.keys(merged.files).sort()).toEqual(["next", "old"]);
    });

    it("breaks a version tie with the lower versionNonce, whichever side sent it", () => {
        const low = { id: "a", version: 2, versionNonce: 10, index: "a0" };
        const high = { id: "a", version: 2, versionNonce: 90, index: "a0" };

        expect(mergeCanvas({ elements: [high] }, { elements: [low] }).elements).toEqual([low]);
        expect(mergeCanvas({ elements: [low] }, { elements: [high] }).elements).toEqual([low]);
    });
});
