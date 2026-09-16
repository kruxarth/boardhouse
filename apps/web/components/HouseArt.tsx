"use client";

const STARS: Array<{ left: string; top: string; dim?: boolean }> = [
    { left: "6%", top: "18%" },
    { left: "16%", top: "55%", dim: true },
    { left: "27%", top: "12%" },
    { left: "72%", top: "30%", dim: true },
    { left: "86%", top: "48%" },
    { left: "93%", top: "14%", dim: true },
];

export function SkyArt() {
    return (
        <div className="sky" aria-hidden="true">
            <svg className="moon" viewBox="0 0 24 24">
                <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
            </svg>
            {STARS.map((star, index) => (
                <svg
                    className={`star${star.dim ? " star-dim" : ""}`}
                    key={index}
                    style={{ left: star.left, top: star.top }}
                    viewBox="0 0 10 10"
                >
                    <path d="M5 1v8M1 5h8" />
                </svg>
            ))}
        </div>
    );
}

export function RoofArt() {
    return (
        <svg className="roof" viewBox="0 0 1000 190" preserveAspectRatio="none" aria-hidden="true">
            <defs>
                <filter id="roof-wobble" x="-5%" y="-30%" width="110%" height="160%">
                    <feTurbulence
                        type="fractalNoise"
                        baseFrequency="0.012 0.045"
                        numOctaves="2"
                        seed="7"
                        result="noise"
                    />
                    <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" />
                </filter>
            </defs>
            <g filter="url(#roof-wobble)">
                <path d="M30 172 L500 34 L970 172" />
                <path d="M14 172 H986" />
                <path d="M705 172 V64 H769 V172" />
                <path d="M694 64 H780" />
                <g className="smoke">
                    <path className="smoke-a" d="M737 50 c-13 -9 11 -15 -1 -26" />
                    <path className="smoke-b" d="M737 36 c-11 -8 10 -13 0 -23" />
                    <path className="smoke-c" d="M737 22 c-9 -7 9 -11 1 -18" />
                </g>
            </g>
        </svg>
    );
}
