"use client";

import styles from "../app/landing.module.css";

function unit(seed: number) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

export function wobble(seed: number, amount: number) {
    return (unit(seed) - 0.5) * 2 * amount;
}

const n = (value: number) => Math.round(value * 100) / 100;

// One marker loop around a w×h box: bowed sides, a little overshoot where the pen lifts.
export function sketchedBox(seed: number, w: number, h: number, overshoot = true, inset = 4) {
    const corners = [
        [inset + wobble(seed, 1.4), inset + wobble(seed + 1, 1.4)],
        [w - inset + wobble(seed + 2, 1.4), inset + wobble(seed + 3, 1.4)],
        [w - inset + wobble(seed + 4, 1.4), h - inset + wobble(seed + 5, 1.4)],
        [inset + wobble(seed + 6, 1.4), h - inset + wobble(seed + 7, 1.4)],
    ] as const;
    const [start, second] = corners;
    let d = `M ${n(start[0] - 2)} ${n(start[1] + 3)}`;
    for (let side = 0; side < 4; side += 1) {
        const [x1, y1] = corners[side]!;
        const [x2, y2] = corners[(side + 1) % 4]!;
        const bow = wobble(seed + 10 + side, 1.8);
        const across = side % 2 === 0;
        const mx = (x1 + x2) / 2 + (across ? 0 : bow);
        const my = (y1 + y2) / 2 + (across ? bow : 0);
        d += ` Q ${n(mx)} ${n(my)} ${n(x2)} ${n(y2)}`;
    }
    return overshoot ? `${d} L ${n(second[0] - 8)} ${n(second[1] + wobble(seed + 20, 1))}` : d;
}

// Two drawings of the same house: 5×2 windows on wide screens, 2×5 on phones.
// Units are about 1/1000 of the house width so strokes scale with it.
// The peak sits a little off centre and the eaves don't quite match: it was drawn by hand.
const HOUSE = {
    wide: {
        roof: { w: 1000, h: 190 },
        roofPath: "M 10 188 Q 252 102 507 8 Q 752 92 990 183 Q 500 189 8 187",
        chimney: "M 700 78 L 701 28 Q 730 25 759 28 L 760 99.5",
        chimneyTop: { x: 730, y: 22, scale: 1.3 },
        facade: { w: 890, h: 340 },
    },
    narrow: {
        roof: { w: 1000, h: 300 },
        roofPath: "M 10 296 Q 252 158 506 10 Q 752 146 990 290 Q 500 298 8 295",
        chimney: "M 700 122 L 702 50 Q 740 46 778 50 L 780 168",
        chimneyTop: { x: 740, y: 42, scale: 2.2 },
        facade: { w: 920, h: 1865 },
    },
} as const;

type Layout = keyof typeof HOUSE;

export type Hearth = "smoke" | "asleep";

const PUFF = "M 0 0 C -13 -1 -15 -16 -4 -20 C -3 -31 14 -32 17 -21 C 28 -20 27 -4 15 -3";
const ZEE = "M 0 0 L 11 0 L 0 13 L 12 13";

function Chimney({ layout, hearth }: { layout: Layout; hearth: Hearth }) {
    const { x, y, scale } = HOUSE[layout].chimneyTop;
    return (
        <g transform={`translate(${x} ${y}) scale(${scale})`}>
            {hearth === "smoke"
                ? [0, 1, 2].map((puff) => (
                      <path
                          className={styles.puff}
                          d={PUFF}
                          key={puff}
                          pathLength={1}
                          style={{ animationDelay: `${1.2 + puff * 1.5}s` }}
                      />
                  ))
                : [0, 1, 2].map((zee) => (
                      <g key={zee} transform={`translate(${zee * 9} ${-zee * 12}) scale(${0.7 + zee * 0.2})`}>
                          <path
                              className={styles.zee}
                              d={ZEE}
                              pathLength={1}
                              style={{ animationDelay: `${1.2 + zee * 0.8}s` }}
                          />
                      </g>
                  ))}
        </g>
    );
}

function RoofDrawing({ layout, hearth }: { layout: Layout; hearth: Hearth }) {
    const house = HOUSE[layout];
    return (
        <svg
            className={`${styles.roof} ${styles[layout]}`}
            viewBox={`0 0 ${house.roof.w} ${house.roof.h}`}
            preserveAspectRatio="none"
            aria-hidden="true"
        >
            <g filter="url(#bh-marker)">
                <path className={`${styles.ink} ${styles.drawRoof}`} d={house.roofPath} pathLength={1} />
                <path className={`${styles.ink} ${styles.drawChimney}`} d={house.chimney} pathLength={1} />
                <Chimney hearth={hearth} layout={layout} />
            </g>
        </svg>
    );
}

function FacadeDrawing({ layout }: { layout: Layout }) {
    const { w, h } = HOUSE[layout].facade;
    const wall = `M 7 2 Q ${n(w * 0.002)} ${h / 2} 4 ${h - 3} Q ${w / 2} ${h + 1} ${w - 4} ${h - 4} Q ${w - 2} ${h / 2} ${w - 5} 3`;
    const ground = `M -45 ${h - 1} Q ${n(w * 0.33)} ${h - 6} ${n(w * 0.66)} ${h} T ${w + 45} ${h - 2}`;
    return (
        <svg
            className={`${styles.facade} ${styles[layout]}`}
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
            aria-hidden="true"
        >
            <g filter="url(#bh-marker)">
                <path className={`${styles.ink} ${styles.drawFacade}`} d={wall} pathLength={1} />
                <path className={`${styles.ink} ${styles.drawGround}`} d={ground} pathLength={1} />
            </g>
        </svg>
    );
}

export function MarkerFilters() {
    return (
        <svg className={styles.defs} aria-hidden="true">
            <defs>
                <filter id="bh-marker" x="-5%" y="-5%" width="110%" height="110%">
                    <feTurbulence
                        type="fractalNoise"
                        baseFrequency="0.06"
                        numOctaves="2"
                        seed="3"
                        result="grain"
                    />
                    <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.8" />
                </filter>
                <filter id="bh-smear" x="-10%" y="-30%" width="120%" height="160%">
                    <feTurbulence
                        type="fractalNoise"
                        baseFrequency="0.04 0.2"
                        numOctaves="2"
                        seed="9"
                        result="streak"
                    />
                    <feDisplacementMap in="SourceGraphic" in2="streak" scale="7" />
                    <feGaussianBlur stdDeviation="0.8" />
                </filter>
            </defs>
        </svg>
    );
}

export function Roof({ hearth }: { hearth: Hearth }) {
    return (
        <>
            <RoofDrawing hearth={hearth} layout="wide" />
            <RoofDrawing hearth={hearth} layout="narrow" />
        </>
    );
}

export function Facade() {
    return (
        <>
            <FacadeDrawing layout="wide" />
            <FacadeDrawing layout="narrow" />
        </>
    );
}

export function WindowOutline({
    index,
    tone,
}: {
    index: number;
    tone: "pink" | "dark" | "ghost";
}) {
    return (
        <svg className={styles.outline} viewBox="0 0 125 100" aria-hidden="true">
            <g filter="url(#bh-marker)">
                <path
                    className={`${styles.ink} ${styles.drawWindow} ${styles[tone]}`}
                    d={sketchedBox(index * 13, 125, 100, tone !== "dark")}
                    pathLength={1}
                />
                {index % 4 === 3 && tone !== "dark" ? (
                    <path
                        className={`${styles.ink} ${styles.drawWindow} ${styles.retrace} ${styles[tone]}`}
                        d={sketchedBox(index * 29, 125, 100, false)}
                        pathLength={1}
                        transform="translate(1.8 1.2) rotate(0.7 62 50)"
                    />
                ) : null}
            </g>
        </svg>
    );
}

export function Smudge({ index }: { index: number }) {
    const lift = wobble(index * 7, 6);
    return (
        <svg
            className={styles.smudge}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
        >
            <g filter="url(#bh-smear)">
                <path
                    d={`M 14 ${n(46 + lift)} C 30 ${n(30 + lift)}, 64 ${n(62 - lift)}, 86 ${n(42 - lift)}`}
                />
                <path d={`M 20 ${n(62 - lift)} C 40 ${n(50 + lift)}, 58 ${n(70 + lift)}, 80 ${n(58 - lift)}`} />
            </g>
        </svg>
    );
}

// Little things people leave in the corner of a window while they work.
const DOODLES = [
    "M 50 10 L 60 36 L 88 37 L 66 54 L 74 82 L 50 66 L 26 82 L 34 54 L 12 37 L 40 36 Z",
    "M 52 50 C 52 44 62 44 62 52 C 62 62 46 64 42 52 C 38 38 58 32 68 44 C 78 58 66 76 50 76 C 30 76 22 56 30 40 C 38 24 62 20 76 30",
    "M 50 84 C 22 64 12 46 22 30 C 32 16 48 24 50 36 C 52 24 68 16 78 30 C 88 46 78 64 50 84",
    "M 56 8 L 30 52 L 52 52 L 42 92 L 74 42 L 52 42 Z",
    "M 24 70 C 10 70 10 50 26 50 C 24 32 46 26 54 40 C 60 28 80 32 78 48 C 92 48 92 70 76 70 Z",
    "M 24 40 L 22 18 L 38 30 C 46 26 56 26 62 30 L 78 18 L 76 40 C 84 56 72 78 50 78 C 28 78 16 56 24 40 M 38 48 L 38 50 M 62 48 L 62 50 M 46 60 Q 50 64 54 60",
    "M 34 30 a 16 16 0 1 0 32 0 a 16 16 0 1 0 -32 0 M 50 4 L 50 10 M 24 30 L 18 30 M 76 30 L 82 30 M 32 12 L 28 8 M 68 12 L 72 8 M 20 78 Q 35 66 50 78 T 80 78",
    "M 12 60 L 70 60 M 56 44 L 72 60 L 56 76",
];

export function WindowDoodle({ seed, live }: { seed: string; live: boolean }) {
    let hash = 0;
    for (const char of seed) {
        hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    return (
        <svg className={styles.doodle} viewBox="0 0 100 100" aria-hidden="true">
            <path
                className={live ? `${styles.doodleInk} ${styles.doodleLive}` : styles.doodleInk}
                d={DOODLES[hash % DOODLES.length]}
                pathLength={1}
            />
        </svg>
    );
}

/** Someone played a round in the margin and half wiped it off. */
export function LeftoverGame() {
    return (
        <svg className={styles.leftover} viewBox="0 0 100 100" aria-hidden="true">
            <g filter="url(#bh-smear)">
                <path d="M 36 8 Q 34 50 37 92 M 66 6 Q 68 50 64 90 M 8 36 Q 50 33 92 37 M 6 66 Q 50 68 94 64" />
                <path d="M 12 12 L 28 28 M 28 12 L 12 28 M 44 44 L 58 58 M 58 44 L 44 58" />
                <path d="M 71 20 a 9 9 0 1 0 18 0 a 9 9 0 1 0 -18 0" />
            </g>
        </svg>
    );
}

export type TrayMood = "sit" | "knock" | "quiet" | "hold" | null;

const MOOD_CLASS = {
    sit: styles.moodSit,
    hold: styles.moodSit,
    knock: styles.moodKnock,
    quiet: styles.moodQuiet,
} as const;

export function TrayMarkers({ mood }: { mood: TrayMood }) {
    return (
        <svg
            className={mood ? `${styles.trayArt} ${MOOD_CLASS[mood]}` : styles.trayArt}
            viewBox="0 0 236 40"
            aria-hidden="true"
        >
            <g className={styles.trayPink}>
                <rect x="4" y="16" width="62" height="12" rx="6" fill="#E23A74" />
                <rect x="4" y="16" width="16" height="12" rx="6" fill="#1D2946" opacity="0.18" />
                <path d="M 66 18.5 L 76 20.5 L 76 23.5 L 66 25.5 Z" fill="#E23A74" />
            </g>
            <g className={styles.trayDark}>
                <rect x="88" y="16" width="62" height="12" rx="6" fill="#1D2946" />
                <rect x="88" y="16" width="16" height="12" rx="6" fill="#F3F6F8" opacity="0.2" />
                <path d="M 150 18.5 L 160 20.5 L 160 23.5 L 150 25.5 Z" fill="#1D2946" />
            </g>
            <g className={styles.trayEraser}>
                <rect x="174" y="10" width="56" height="20" rx="3" fill="#1D2946" />
                <rect x="174" y="24" width="56" height="7" rx="2" fill="#D6DCE2" />
            </g>
        </svg>
    );
}
