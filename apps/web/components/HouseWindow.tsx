"use client";

import { EMPTY_TABLE_MS } from "@repo/common/constants";
import styles from "../app/landing.module.css";
import type { HouseTable } from "../lib/api";
import { Smudge, WindowDoodle, WindowOutline, wobble, type TrayMood } from "./HouseArt";

function classes(...names: (string | false | undefined)[]) {
    return names.filter(Boolean).join(" ");
}

// No two windows hang quite level.
function hangStyle(index: number) {
    return {
        "--i": index,
        "--tilt": `${wobble(index * 5, 0.9)}deg`,
        "--nudge-x": `${wobble(index * 7, 1.6)}px`,
        "--nudge-y": `${wobble(index * 11, 1.6)}px`,
    } as React.CSSProperties;
}

export function LoadingWindow({ index }: { index: number }) {
    return (
        <div className={classes(styles.win, styles.loading)} style={hangStyle(index)}>
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
    onMood,
}: {
    index: number;
    table: HouseTable;
    disabled: boolean;
    selected?: boolean;
    wiping?: boolean;
    onEmpty: () => void;
    onUnused: (slug: string) => void;
    onOccupied: (slug: string) => void;
    onMood: (mood: TrayMood) => void;
}) {
    const style = hangStyle(index);
    const moodEvents = (mood: TrayMood) => ({
        onPointerEnter: () => onMood(mood),
        onPointerLeave: () => onMood(null),
        onFocus: () => onMood(mood),
        onBlur: () => onMood(null),
    });

    if (table.empty) {
        return (
            <button
                aria-label={`Table ${index}, empty. Sit here.`}
                className={classes(styles.win, styles.empty, selected && styles.selected)}
                disabled={disabled}
                onClick={onEmpty}
                style={style}
                {...moodEvents("sit")}
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
        const quietMin = Math.max(EMPTY_TABLE_MS / 60_000, Math.floor((table.quietMs ?? 0) / 60_000));
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
                {...moodEvents("quiet")}
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
            {...moodEvents("knock")}
        >
            <WindowOutline index={index} tone="pink" />
            <WindowDoodle live={table.seated > 0} seed={table.slug} />
            <span className={styles.words}>
                <span className={styles.title}>{title}</span>
                <span className={styles.host}>Host {host}</span>
            </span>
        </button>
    );
}
