/**
 * Ten faces for ten seats. The table hands out a permutation, so nobody at a
 * sitting shares one.
 */

export const AVATARS = [
    { name: "Moth", src: "/avatars/moth.png" },
    { name: "Moon", src: "/avatars/moon.png" },
    { name: "Key", src: "/avatars/key.png" },
    { name: "Teacup", src: "/avatars/teacup.png" },
    { name: "Match", src: "/avatars/match.png" },
    { name: "Bell", src: "/avatars/bell.png" },
    { name: "Record", src: "/avatars/record.png" },
    { name: "Hourglass", src: "/avatars/hourglass.png" },
    { name: "Cat", src: "/avatars/cat.png" },
    { name: "Hat", src: "/avatars/hat.png" },
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
