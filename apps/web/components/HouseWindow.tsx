"use client";

import type { HouseTable } from "../lib/api";

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
        return (
            <button
                aria-label={`Table ${index}, unused. ${title}. Claim this table.`}
                className="window window-unused"
                disabled={disabled}
                onClick={() => onUnused(table.slug)}
                type="button"
            >
                <i className="muntin muntin-v" aria-hidden="true" />
                <i className="muntin muntin-h" aria-hidden="true" />
                <span className="win-no" aria-hidden="true">
                    {index}
                </span>
                <span className="win-body">
                    <span className="win-title">{title}</span>
                    <span className="win-host">Unused</span>
                </span>
                <span className="win-cta">Claim this</span>
            </button>
        );
    }

    return (
        <button
            aria-label={`Table ${index}, ${title}. Host ${host}. Knock.`}
            className="window window-lit"
            disabled={disabled}
            onClick={() => onOccupied(table.slug)}
            type="button"
        >
            <i className="muntin muntin-v" aria-hidden="true" />
            <i className="muntin muntin-h" aria-hidden="true" />
            <span className="win-no" aria-hidden="true">
                {index}
            </span>
            <span className="win-marker" aria-hidden="true" />
            <span className="win-body">
                <span className="win-title">{title}</span>
                <span className="win-host">Host {host}</span>
            </span>
            <span className="win-cta">Knock</span>
        </button>
    );
}
