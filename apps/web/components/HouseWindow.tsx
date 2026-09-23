"use client";

import type { HouseTable } from "../lib/api";

function WindowBulb({ on }: { on: boolean }) {
    return (
        <span className={on ? "win-bulb win-bulb-on" : "win-bulb win-bulb-off"} aria-hidden="true">
            <svg viewBox="0 0 20 32" fill="none">
                <path d="M10 0 v7" stroke="currentColor" strokeWidth="1.2" />
                <rect x="7.2" y="6.4" width="5.6" height="3.2" rx="0.4" fill="currentColor" />
                <path
                    d="M6.2 10.2 C4.1 12.8 4 17.4 7 20.2 C8 21.1 8.4 22.2 8.4 23.4 h3.2 c0-1.2 0.4-2.3 1.4-3.2 C16 17.4 15.9 12.8 13.8 10.2 Z"
                    fill="currentColor"
                    fillOpacity={on ? 0.95 : 0.12}
                    stroke="currentColor"
                    strokeWidth="1.15"
                />
                {on ? null : (
                    <path
                        d="M8.2 12.4 C9.1 14.2 9.2 16.4 8.6 18.6 M11.8 12.4 C10.9 14.2 10.8 16.4 11.4 18.6"
                        stroke="currentColor"
                        strokeWidth="1"
                    />
                )}
                <path d="M8.4 23.4 h3.2 v1.6 h-3.2 z M8.8 25.6 h2.4 v1.3 h-2.4 z" fill="currentColor" />
            </svg>
        </span>
    );
}

export function HouseWindow({
    index,
    table,
    disabled,
    onEmpty,
    onUnused,
    onOccupied,
}: {
    index: number;
    table: HouseTable;
    disabled: boolean;
    onEmpty: () => void;
    onUnused: (slug: string) => void;
    onOccupied: (slug: string) => void;
}) {
    if (table.empty) {
        return (
            <button
                aria-label={`Table ${index}, empty. Sit here.`}
                className="window window-dark"
                disabled={disabled}
                onClick={onEmpty}
                type="button"
            >
                <i className="muntin muntin-v" aria-hidden="true" />
                <i className="muntin muntin-h" aria-hidden="true" />
                <WindowBulb on={false} />
                <span className="win-no" aria-hidden="true">
                    {index}
                </span>
                <span className="win-empty">Empty</span>
                <span className="win-cta">Sit here</span>
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
                className="window window-unused"
                disabled={disabled}
                onClick={() => onUnused(table.slug)}
                type="button"
            >
                <i className="muntin muntin-v" aria-hidden="true" />
                <i className="muntin muntin-h" aria-hidden="true" />
                <WindowBulb on={false} />
                <span className="win-no" aria-hidden="true">
                    {index}
                </span>
                <span className="win-body">
                    <span className="win-title">{title}</span>
                    <span className="win-host">Inactive</span>
                    <span className="win-quiet">{quietLabel}</span>
                </span>
                <span className="win-cta">Claim this</span>
            </button>
        );
    }

    const seated = table.seated ?? 0;

    return (
        <button
            aria-label={`Table ${index}, ${title}. Host ${host}.${seated > 0 ? ` ${seated} seated.` : ""} Knock.`}
            className="window window-lit"
            disabled={disabled}
            onClick={() => onOccupied(table.slug)}
            type="button"
        >
            <i className="muntin muntin-v" aria-hidden="true" />
            <i className="muntin muntin-h" aria-hidden="true" />
            <WindowBulb on />
            <span className="win-no" aria-hidden="true">
                {index}
            </span>
                <span className="win-body">
                    <span className="win-title">{title}</span>
                    <span className="win-host">Host {host}</span>
                    {seated > 0 ? (
                        <span className="win-count">
                            {seated === 1 ? "1 seated" : `${seated} seated`}
                        </span>
                    ) : null}
                </span>
            <span className="win-cta">Knock</span>
        </button>
    );
}
