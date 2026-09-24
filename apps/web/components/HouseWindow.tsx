"use client";

import styles from "../app/landing.module.css";
import type { HouseTable } from "../lib/api";
import { Smudge, WindowOutline } from "./HouseArt";

function classes(...names: (string | false | undefined)[]) {
    return names.filter(Boolean).join(" ");
}

export function LoadingWindow({ index }: { index: number }) {
    return (
        <div className={classes(styles.win, styles.loading)}>
            <WindowOutline index={index} tone="ghost" />
        </div>
    );
}

export function HouseWindow({
    index,
    table,
    disabled,
    selected,
    wiping,
    onEmpty,
    onUnused,
    onOccupied,
}: {
    index: number;
    table: HouseTable;
    disabled: boolean;
    selected?: boolean;
    wiping?: boolean;
    onEmpty: () => void;
    onUnused: (slug: string) => void;
    onOccupied: (slug: string) => void;
}) {
    const style = { "--i": index } as React.CSSProperties;

    if (table.empty) {
        return (
            <button
                aria-label={`Table ${index}, empty. Sit here.`}
                className={classes(styles.win, styles.empty, selected && styles.selected)}
                disabled={disabled}
                onClick={onEmpty}
                style={style}
                type="button"
            >
                <WindowOutline index={index} tone="dark" />
                <span className={classes(styles.words, styles.sit)}>sit here</span>
            </button>
        );
    }

    const title = table.name?.trim() || "Untitled table";
    const host = table.hostName?.trim() || "Someone";

    if (table.unused) {
        const quietMin = Math.max(10, Math.floor((table.quietMs ?? 0) / 60_000));
        const quietLabel =
            quietMin >= 120 ? `Quiet ${Math.floor(quietMin / 60)}h` : `Quiet ${quietMin}m`;
        return (
            <button
                aria-label={`Table ${index}, ${title}, quiet for ${quietMin} minutes. Claim it and wipe the old board.`}
                className={classes(
                    styles.win,
                    styles.quiet,
                    selected && styles.selected,
                    wiping && styles.wiping
                )}
                disabled={disabled}
                onClick={() => onUnused(table.slug)}
                style={style}
                type="button"
            >
                <WindowOutline index={index} tone="ghost" />
                <Smudge index={index} />
                <span className={styles.words}>
                    <span className={styles.residue}>{title}</span>
                    <span className={styles.claimNote}>quiet · claim it</span>
                    <span className={styles.quietTime}>{quietLabel}</span>
                </span>
                {wiping ? <span className={styles.eraser} aria-hidden="true" /> : null}
            </button>
        );
    }

    return (
        <button
            aria-label={`Table ${index}, ${title}. Host ${host}. Knock to join.`}
            className={classes(styles.win, styles.inUse)}
            disabled={disabled}
            onClick={() => onOccupied(table.slug)}
            style={style}
            type="button"
        >
            <WindowOutline index={index} tone="pink" />
            <span className={styles.words}>
                <span className={styles.title}>{title}</span>
                <span className={styles.host}>Host {host}</span>
            </span>
        </button>
    );
}
