/**
 * Ten faces for ten seats. The table hands out a permutation, so nobody at a
 * sitting shares one. Silhouettes are picked to stay apart at ~20px.
 */

function MothFace() {
    return (
        <>
            <path d="M11.5 9.6C8.3 6.6 4 7.7 4 11.4c0 3.3 3.5 5.5 7.5 5.2Z" />
            <path d="M12.5 9.6C15.7 6.6 20 7.7 20 11.4c0 3.3-3.5 5.5-7.5 5.2Z" />
            <path d="M12 8.8v8.4M12 8.6 10.2 6.2M12 8.6l1.8-2.4" />
        </>
    );
}

function MoonFace() {
    return <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z" />;
}

function KeyFace() {
    return (
        <>
            <circle cx="8.4" cy="15.6" r="3.6" />
            <path d="M11 13 19 5M16.4 7.6l2 2M14 10l2 2" />
        </>
    );
}

function TeacupFace() {
    return (
        <>
            <path d="M5.6 9h11v3.2a5.5 5.5 0 0 1-11 0Z" />
            <path d="M16.6 9.8H18a2.2 2.2 0 0 1 0 4.4h-1.4" />
            <path d="M3.6 19.4h16.8" />
        </>
    );
}

function MatchFace() {
    return (
        <>
            <path d="M5.4 19.6 13 12" />
            <path d="M15.2 4.6c2.7 2.1 3.9 3.8 3.9 5.7a3.95 3.95 0 0 1-7.9 0c0-1.5.8-2.7 2-3.7.2 1.2.7 1.9 1.4 2 .1-1.4.3-2.7.6-4Z" />
        </>
    );
}

function BellFace() {
    return (
        <>
            <circle cx="12" cy="4.6" r="1.2" />
            <path d="M4.8 16.2a7.2 7.2 0 0 1 14.4 0Z" />
            <path d="M3.2 16.2h17.6" />
            <path d="M6.6 18.8h10.8" />
        </>
    );
}

function RecordFace() {
    return (
        <>
            <circle cx="12" cy="12" r="8.2" />
            <circle cx="12" cy="12" r="3.4" />
            <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
        </>
    );
}

function HourglassFace() {
    return (
        <>
            <path d="M6 4.2h12M6 19.8h12" />
            <path d="M7.8 4.2c0 4 4.2 5.6 4.2 7.8s-4.2 3.8-4.2 7.8" />
            <path d="M16.2 4.2c0 4-4.2 5.6-4.2 7.8s4.2 3.8 4.2 7.8" />
        </>
    );
}

function CatFace() {
    return (
        <>
            <path d="M6.6 10.6 5.4 5.2l4.4 2.6a8.6 8.6 0 0 1 4.4 0l4.4-2.6-1.2 5.4c.5 1 .8 2.1.8 3.2 0 3.6-3.1 6.2-6.2 6.2s-6.2-2.6-6.2-6.2c0-1.1.3-2.2.8-3.2Z" />
            <path d="M9.8 13.4h.1M14.1 13.4h.1" strokeWidth="2.2" strokeLinecap="round" />
        </>
    );
}

function HatFace() {
    return (
        <>
            <path d="M6.7 14.6c-.7-4.5.7-8.2 5.3-8.2s6 3.7 5.3 8.2" />
            <path d="M3.2 15.2c0 1.5 3.9 2.5 8.8 2.5s8.8-1 8.8-2.5-3.9-2.1-8.8-2.1-8.8.6-8.8 2.1Z" />
            <path d="M7.5 13.2c1.3.4 2.9.6 4.5.6s3.2-.2 4.5-.6" />
        </>
    );
}

export const AVATARS = [
    { name: "Moth", Art: MothFace },
    { name: "Moon", Art: MoonFace },
    { name: "Key", Art: KeyFace },
    { name: "Teacup", Art: TeacupFace },
    { name: "Match", Art: MatchFace },
    { name: "Bell", Art: BellFace },
    { name: "Record", Art: RecordFace },
    { name: "Hourglass", Art: HourglassFace },
    { name: "Cat", Art: CatFace },
    { name: "Hat", Art: HatFace },
] as const;

export function avatarName(index: number) {
    return AVATARS[index % AVATARS.length]?.name ?? "Moth";
}

export function Avatar({ index }: { index: number }) {
    const safe = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
    const entry = AVATARS[safe % AVATARS.length] ?? AVATARS[0];
    const { Art } = entry;
    return (
        <svg
            aria-hidden="true"
            className="face"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
        >
            <Art />
        </svg>
    );
}
