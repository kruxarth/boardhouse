/**
 * Ten faces for ten seats. The table hands out a permutation, so nobody at a
 * sitting shares one.
 */

export const AVATARS = [
    { name: "Moth", src: "/avatars/moth.png?v=goofy" },
    { name: "Moon", src: "/avatars/moon.png?v=goofy" },
    { name: "Key", src: "/avatars/key.png?v=goofy" },
    { name: "Teacup", src: "/avatars/teacup.png?v=goofy" },
    { name: "Match", src: "/avatars/match.png?v=goofy" },
    { name: "Bell", src: "/avatars/bell.png?v=goofy" },
    { name: "Record", src: "/avatars/record.png?v=goofy" },
    { name: "Hourglass", src: "/avatars/hourglass.png?v=goofy" },
    { name: "Cat", src: "/avatars/cat.png?v=goofy" },
    { name: "Hat", src: "/avatars/hat.png?v=goofy" },
] as const;

const AVATAR_COUNT = AVATARS.length;

function hashId(id: string) {
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) {
        hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    }
    return hash % AVATAR_COUNT;
}

export function normalizeAvatarIndex(value: unknown): number | null {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) {
        return null;
    }
    return ((Math.trunc(n) % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
}

function nextFree(start: number, used: Set<number>) {
    for (let i = 0; i < AVATAR_COUNT; i += 1) {
        const index = (start + i) % AVATAR_COUNT;
        if (!used.has(index)) {
            return index;
        }
    }
    return start % AVATAR_COUNT;
}

/** Keep valid unique faces; give everyone else the next free one. */
export function withUniqueAvatars<T extends { id: string; avatar?: number }>(
    people: T[],
    used = new Set<number>()
): T[] {
    const keep = new Map<string, number>();
    const ordered = [...people].sort((a, b) => a.id.localeCompare(b.id));

    for (const person of ordered) {
        const index = normalizeAvatarIndex(person.avatar);
        if (index !== null && !used.has(index)) {
            used.add(index);
            keep.set(person.id, index);
        }
    }

    return people.map((person) => {
        const existing = keep.get(person.id);
        if (existing !== undefined) {
            return { ...person, avatar: existing };
        }
        const index = nextFree(hashId(person.id), used);
        used.add(index);
        return { ...person, avatar: index };
    });
}

export function avatarFromId(id: string) {
    return hashId(id);
}

export function avatarName(index: number, id?: string) {
    const safe = normalizeAvatarIndex(index) ?? (id ? hashId(id) : 0);
    return AVATARS[safe]?.name ?? "Moth";
}

export function Avatar({ index, id }: { index?: number; id?: string }) {
    const safe = normalizeAvatarIndex(index) ?? (id ? hashId(id) : 0);
    const entry = AVATARS[safe] ?? AVATARS[0];
    return (
        <img
            alt=""
            aria-hidden="true"
            className="face"
            draggable={false}
            height={24}
            src={entry.src}
            width={24}
        />
    );
}
