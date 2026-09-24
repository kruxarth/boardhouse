"use client";

import styles from "../app/landing.module.css";

function unit(seed: number) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

function wobble(seed: number, amount: number) {
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
const HOUSE = {
    wide: {
        roof: { w: 1000, h: 190 },
        roofPath: "M 10 188 Q 250 100 500 8 Q 750 96 990 186 Q 500 190 8 187",
        chimney: "M 700 80 L 701 28 Q 730 25 759 28 L 760 102",
        facade: { w: 890, h: 340 },
    },
    narrow: {
        roof: { w: 1000, h: 300 },
        roofPath: "M 10 296 Q 250 156 500 10 Q 750 150 990 294 Q 500 299 8 295",
        chimney: "M 700 126 L 702 50 Q 740 46 778 50 L 780 172",
        facade: { w: 920, h: 1865 },
    },
} as const;

type Layout = keyof typeof HOUSE;

function RoofDrawing({ layout }: { layout: Layout }) {
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
            </g>
        </svg>
    );
}

function FacadeDrawing({ layout }: { layout: Layout }) {
    const { w, h } = HOUSE[layout].facade;
    const wall = `M 4 2 Q ${n(w * 0.003)} ${h / 2} 5 ${h - 3} Q ${w / 2} ${h + 1} ${w - 4} ${h - 4} Q ${w - 2} ${h / 2} ${w - 5} 3`;
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

export function Roof() {
    return (
        <>
            <RoofDrawing layout="wide" />
            <RoofDrawing layout="narrow" />
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

export function TrayMarkers() {
    return (
        <svg className={styles.trayArt} viewBox="0 0 236 40" aria-hidden="true">
            <g>
                <rect x="4" y="16" width="62" height="12" rx="6" fill="#E23A74" />
                <rect x="4" y="16" width="16" height="12" rx="6" fill="#1D2946" opacity="0.18" />
                <path d="M 66 18.5 L 76 20.5 L 76 23.5 L 66 25.5 Z" fill="#E23A74" />
            </g>
            <g>
                <rect x="88" y="16" width="62" height="12" rx="6" fill="#1D2946" />
                <rect x="88" y="16" width="16" height="12" rx="6" fill="#F3F6F8" opacity="0.2" />
                <path d="M 150 18.5 L 160 20.5 L 160 23.5 L 150 25.5 Z" fill="#1D2946" />
            </g>
            <g>
                <rect x="174" y="10" width="56" height="20" rx="3" fill="#1D2946" />
                <rect x="174" y="24" width="56" height="7" rx="2" fill="#D6DCE2" />
            </g>
        </svg>
    );
}
