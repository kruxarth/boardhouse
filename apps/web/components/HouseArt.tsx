"use client";

function unit(seed: number) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

export function markerSegment(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    seed: number,
    amount = 0.7
) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const bow = (unit(seed) - 0.5) * 2 * amount;
    const mx = (x1 + x2) / 2 + (-dy / len) * bow;
    const my = (y1 + y2) / 2 + (dx / len) * bow;
    const n = (value: number) => Math.round(value * 100) / 100;
    return `M ${n(x1)} ${n(y1)} Q ${n(mx)} ${n(my)} ${n(x2)} ${n(y2)}`;
}

function Stroke({
    d,
    phase,
}: {
    d: string;
    phase: "ground" | "wall" | "roof" | "frame" | "door";
}) {
    return <path className={`wb-stroke wb-stroke-${phase}`} d={d} />;
}

export function MarkerDefs() {
    return (
        <svg className="wb-defs" aria-hidden="true">
            <defs>
                <filter id="wb-marker-roof" x="-6%" y="-20%" width="112%" height="150%">
                    <feTurbulence
                        type="fractalNoise"
                        baseFrequency="0.012 0.04"
                        numOctaves="2"
                        seed="4"
                        result="noise"
                    />
                    <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" />
                </filter>
                <filter id="wb-marker-wall" x="-8%" y="-8%" width="116%" height="116%">
                    <feTurbulence
                        type="fractalNoise"
                        baseFrequency="0.02 0.05"
                        numOctaves="2"
                        seed="8"
                        result="noise"
                    />
                    <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.45" />
                </filter>
                <filter id="wb-marker-win" x="-12%" y="-12%" width="124%" height="124%">
                    <feTurbulence
                        type="fractalNoise"
                        baseFrequency="0.03 0.07"
                        numOctaves="2"
                        seed="11"
                        result="noise"
                    />
                    <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.55" />
                </filter>
            </defs>
        </svg>
    );
}

export function RoofSketch({ home }: { home: boolean }) {
    const slopeLeft = markerSegment(18, 196, 470, 22, 2, 6);
    const slopeRight = markerSegment(470, 22, 984, 194, 3, 6);
    const chimney = [
        markerSegment(700, 108, 700, 36, 4, 0.35),
        markerSegment(700, 36, 764, 30, 5, 0.35),
        markerSegment(764, 30, 764, 130, 6, 0.35),
    ].join(" ");
    const smoke = "M 726 38 C 712 24, 744 14, 720 2";
    return (
        <svg className="wb-roof" viewBox="0 0 1000 210" aria-hidden="true">
            <g filter="url(#wb-marker-roof)">
                <Stroke d={chimney} phase="roof" />
                <Stroke d={slopeLeft} phase="roof" />
                <Stroke d={slopeRight} phase="roof" />
                {home ? <Stroke d={smoke} phase="roof" /> : null}
            </g>
        </svg>
    );
}

export function WallSketch() {
    const desk = [
        markerSegment(0, 0, 100, 0, 20, 0.35),
        markerSegment(0, 0, 0, 100, 21, 0.45),
        markerSegment(100, 0, 100, 100, 22, 0.45),
        markerSegment(0, 100, 50, 100, 23, 0.28),
    ].join(" ");
    const mob = [
        markerSegment(0, 0, 100, 0, 30, 0.35),
        markerSegment(0, 0, 0, 100, 31, 0.45),
        markerSegment(100, 0, 100, 100, 32, 0.45),
    ].join(" ");
    return (
        <svg className="wb-walls" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <g className="wb-lines-desk" filter="url(#wb-marker-wall)">
                <Stroke d={desk} phase="wall" />
            </g>
            <g className="wb-lines-mob" filter="url(#wb-marker-wall)">
                <Stroke d={mob} phase="wall" />
            </g>
        </svg>
    );
}

export function GroundSketch() {
    const d = "M 0 14 Q 160 7 320 15 T 640 11 T 1000 16";
    return (
        <svg className="wb-ground" viewBox="0 0 1000 26" preserveAspectRatio="none" aria-hidden="true">
            <g filter="url(#wb-marker-roof)">
                <Stroke d={d} phase="ground" />
            </g>
        </svg>
    );
}

export function DoorSketch() {
    const arch = [
        "M 16 224",
        "C 12 128, 36 22, 130 14",
        "C 224 6, 248 118, 244 224",
    ].join(" ");
    return (
        <svg className="wb-door-art" viewBox="0 0 260 232" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
            <g filter="url(#wb-marker-win)">
                <Stroke d={arch} phase="door" />
                <circle className="wb-stroke wb-stroke-door" cx="226" cy="128" r="6.2" />
            </g>
        </svg>
    );
}

export function WindowLines({ index, faint }: { index: number; faint?: boolean }) {
    const seed = index * 19;
    const d = [
        markerSegment(8, 8, 92, 8, seed, 0.65),
        markerSegment(92, 8, 92, 92, seed + 1, 0.65),
        markerSegment(92, 92, 8, 92, seed + 2, 0.65),
        markerSegment(8, 92, 8, 8, seed + 3, 0.65),
        markerSegment(50, 10, 50, 90, seed + 4, 0.5),
        markerSegment(10, 50, 90, 50, seed + 5, 0.5),
    ].join(" ");
    return (
        <svg className="wb-win-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <g className={faint ? "wb-faint" : undefined} filter="url(#wb-marker-win)">
                <path className="wb-stroke wb-stroke-frame" d={d} />
            </g>
        </svg>
    );
}

export function MarkerLedge() {
    return (
        <div className="wb-ledge" aria-hidden="true">
            <svg viewBox="0 0 250 40">
                <rect x="6" y="15" width="58" height="11" rx="5.5" fill="#E23A74" />
                <rect x="52" y="15" width="14" height="11" rx="2" fill="#F3F6F8" />
                <rect x="82" y="15" width="58" height="11" rx="5.5" fill="#1D2946" />
                <rect x="128" y="15" width="14" height="11" rx="2" fill="#F3F6F8" />
                <rect x="162" y="11" width="52" height="18" rx="2" fill="#F3F6F8" stroke="#B7BEC6" />
                <rect x="162" y="11" width="16" height="18" fill="#D6DCE2" />
            </svg>
        </div>
    );
}
