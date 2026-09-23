"use client";

import type { HouseTable } from "../lib/api";
import { WindowLines } from "./HouseArt";

function WindowBulb({ on }: { on: boolean }) {
    return (
        <span className={on ? "wb-bulb wb-bulb-on" : "wb-bulb wb-bulb-off"} aria-hidden="true">
            <svg viewBox="0 0 36 52">
                <path d="M18 1.5 v6.5" />
                <path d="M13.2 8.2 h9.6" />
                <path
                    className="wb-bulb-glass"
                    d="M11.2 14.2 C8.4 18.4 8.2 26.2 12.4 31.2 C13.8 32.8 14.4 34.4 14.4 36.2 h7.2 c0-1.8 0.6-3.4 2-5 C27.8 26.2 27.6 18.4 24.8 14.2 Z"
                />
                {on ? (
                    <g className="wb-bulb-rays">
                        <path d="M4 16.5 H8.2" />
                        <path d="M27.8 16.5 H32" />
                        <path d="M6.2 10.2 L9.2 12.6" />
                        <path d="M26.8 12.6 L29.8 10.2" />
                        <path d="M6.4 23.4 L9.4 21.4" />
                        <path d="M26.6 21.4 L29.6 23.4" />
                    </g>
                ) : (
                    <path d="M15.2 18.4 v8.2 M20.8 18.4 v8.2" />
                )}
                <path d="M14.6 36.4 h6.8 v2.4 h-6.8 z M15.4 39.4 h5.2 v2 h-5.2 z" />
            </svg>
        </span>
    );
}

function Tally({ count }: { count: number }) {
    const total = Math.min(10, count);
    const groups = Math.ceil(total / 5);
    return (
        <span className="wb-tally" aria-hidden="true">
            {Array.from({ length: groups }, (_, group) => {
                const marks = Math.min(5, total - group * 5);
                const upright = marks === 5 ? 4 : marks;
                return (
                    <span className="wb-tally-group" key={group}>
                        {Array.from({ length: upright }, (_, mark) => (
                            <i key={mark} className="wb-tick" />
                        ))}
                        {marks === 5 ? <i className="wb-tick-slash" /> : null}
                    </span>
                );
            })}
        </span>
    );
}

function Hatch({ index, quiet }: { index: number; quiet?: boolean }) {
    const id = quiet ? `wb-ghost-${index}` : `wb-hatch-${index}`;
    return (
        <svg className={quiet ? "wb-hatch wb-hatch-quiet" : "wb-hatch"} aria-hidden="true">
            <defs>
                <pattern
                    id={id}
                    width="8"
                    height="8"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(32)"
                >
                    <line
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="8"
                        stroke={quiet ? "#D6DCE2" : "#E23A74"}
                        strokeWidth="1.7"
                        strokeOpacity={quiet ? 0.95 : 0.32}
                    />
                </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${id})`} />
            {quiet ? (
                <>
                    <ellipse cx="58%" cy="42%" rx="34%" ry="22%" fill="#F3F6F8" opacity="0.72" />
                    <ellipse cx="36%" cy="64%" rx="22%" ry="14%" fill="#D6DCE2" opacity="0.55" />
                </>
            ) : null}
        </svg>
    );
}

function Trace() {
    return (
        <svg className="wb-trace" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <rect x="1.2" y="1.2" width="97.6" height="97.6" pathLength={1} />
        </svg>
    );
}

export function HouseWindow({
    index,
    table,
    disabled,
    traced,
    wiping,
    onEmpty,
    onUnused,
    onOccupied,
}: {
    index: number;
    table: HouseTable;
    disabled: boolean;
    traced?: boolean;
    wiping?: boolean;
    onEmpty: () => void;
    onUnused: (slug: string) => void;
    onOccupied: (slug: string) => void;
}) {
    if (table.empty) {
        return (
            <button
                aria-label={`Table ${index}, empty. Sit here.`}
                className={traced ? "wb-win wb-win-dark wb-win-traced" : "wb-win wb-win-dark"}
                disabled={disabled}
                onClick={onEmpty}
                type="button"
            >
                <WindowLines index={index} />
                <Trace />
                <WindowBulb on={false} />
                <span className="wb-no" aria-hidden="true">
                    {index}
                </span>
                <span className="wb-content wb-label">sit here</span>
            </button>
        );
    }

    const title = table.name?.trim() || "Untitled sitting";
    const host = table.hostName?.trim() || "Someone";

    if (table.unused) {
        const quietMin = Math.max(10, Math.floor((table.quietMs ?? 0) / 60_000));
        const quietLabel =
            quietMin >= 120 ? `Quiet ${Math.floor(quietMin / 60)}h` : `Quiet ${quietMin}m`;
        return (
            <button
                aria-label={`Table ${index}, inactive for ${quietMin} minutes. ${title}. Claim this table.`}
                className={[
                    "wb-win wb-win-quiet",
                    traced ? "wb-win-traced" : "",
                    wiping ? "wb-win-wiping" : "",
                ]
                    .filter(Boolean)
                    .join(" ")}
                disabled={disabled}
                onClick={() => onUnused(table.slug)}
                type="button"
            >
                <Hatch index={index} quiet />
                <WindowLines index={index} />
                <Trace />
                <WindowBulb on={false} />
                <span className="wb-no" aria-hidden="true">
                    {index}
                </span>
                <span className="wb-content wb-copy">
                    <span className="wb-title wb-residue">{title}</span>
                    <span className="wb-quiet-note">quiet · claim it</span>
                    <span className="wb-quiet-time">{quietLabel}</span>
                </span>
                {wiping ? (
                    <span className="wb-eraser" aria-hidden="true">
                        <svg viewBox="0 0 86 34">
                            <rect x="2" y="4" width="82" height="26" rx="3" fill="#F3F6F8" stroke="#B7BEC6" />
                            <rect x="2" y="4" width="22" height="26" rx="3" fill="#D6DCE2" />
                        </svg>
                    </span>
                ) : null}
            </button>
        );
    }

    const seated = table.seated ?? 0;

    return (
        <button
            aria-label={`Table ${index}, ${title}. Host ${host}.${seated > 0 ? ` ${seated} seated.` : ""} Knock.`}
            className="wb-win wb-win-lit"
            disabled={disabled}
            onClick={() => onOccupied(table.slug)}
            type="button"
        >
            <Hatch index={index} />
            <WindowLines index={index} />
            <Trace />
            <WindowBulb on />
            <span className="wb-no" aria-hidden="true">
                {index}
            </span>
            <span className="wb-content wb-copy">
                <span className="wb-title">{title}</span>
                <span className="wb-host">Host {host}</span>
                {seated > 0 ? <Tally count={seated} /> : null}
            </span>
            <span className="wb-knock">Knock</span>
        </button>
    );
}
