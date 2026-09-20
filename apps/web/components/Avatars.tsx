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

export function avatarName(index: number) {
    return AVATARS[index % AVATARS.length]?.name ?? "Moth";
}

export function Avatar({ index }: { index: number }) {
    const safe = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
    const entry = AVATARS[safe % AVATARS.length] ?? AVATARS[0];
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
