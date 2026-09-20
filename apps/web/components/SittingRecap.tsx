"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BoardCanvas } from "./BoardCanvas";

export type RecapEvent = { t: number; type: string; payload: unknown };

const EMPTY_SCENE = { elements: [] as unknown[] };
const RECAP_MS = 60_000;

function asScene(payload: unknown) {
    if (Array.isArray(payload)) {
        return { elements: payload };
    }
    if (payload && typeof payload === "object" && "elements" in payload) {
        return payload;
    }
    return EMPTY_SCENE;
}

function formatClock(ms: number) {
    const total = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function SittingRecap({
    events,
    onClose,
}: {
    events: RecapEvent[];
    onClose: () => void;
}) {
    const frames = useMemo(
        () => events.filter((event) => event.type === "canvas"),
        [events]
    );
    const firstT = frames[0]?.t ?? 0;
    const lastT = frames[frames.length - 1]?.t ?? firstT;
    const span = Math.max(1, lastT - firstT);
    const playMs = Math.min(RECAP_MS, Math.max(span, 800));
    const [index, setIndex] = useState(0);
    const [playing, setPlaying] = useState(frames.length > 1);
    const [elapsed, setElapsed] = useState(0);
    const indexRef = useRef(0);
    indexRef.current = index;

    useEffect(() => {
        if (!playing || frames.length < 2) {
            return;
        }
        const startIndex = Math.min(Math.max(0, indexRef.current), frames.length - 1);
        const startT = frames[startIndex]?.t ?? firstT;
        const originElapsed = ((startT - firstT) / span) * playMs;
        const originWall = performance.now();
        let frame = 0;
        let stopped = false;
        const tick = () => {
            if (stopped) {
                return;
            }
            const nextElapsed = Math.min(playMs, originElapsed + (performance.now() - originWall));
            const targetT = firstT + (nextElapsed / playMs) * span;
            let next = startIndex;
            for (let i = startIndex; i < frames.length; i += 1) {
                if (frames[i]!.t <= targetT) {
                    next = i;
                } else {
                    break;
                }
            }
            setElapsed(nextElapsed);
            setIndex((current) => (current === next ? current : next));
            if (nextElapsed >= playMs) {
                setPlaying(false);
                return;
            }
            frame = window.requestAnimationFrame(tick);
        };
        frame = window.requestAnimationFrame(tick);
        return () => {
            stopped = true;
            window.cancelAnimationFrame(frame);
        };
    }, [playing, frames, firstT, span, playMs]);

    function togglePlay() {
        if (playing) {
            setPlaying(false);
            return;
        }
        if (frames.length < 2) {
            return;
        }
        const startAt = index >= frames.length - 1 ? 0 : index;
        if (startAt === 0) {
            setElapsed(0);
        }
        indexRef.current = startAt;
        if (startAt !== index) {
            setIndex(startAt);
        }
        setPlaying(true);
    }

    const scene = asScene(frames[index]?.payload);
    const progress = playMs > 0 ? elapsed / playMs : 1;
    const sittingLabel =
        span >= 3_600_000
            ? `${Math.round(span / 3_600_000)}h sitting`
            : span >= 60_000
              ? `${Math.round(span / 60_000)}m sitting`
              : `${Math.round(span / 1000)}s sitting`;

    return (
        <div className="sitting-recap" role="dialog" aria-labelledby="recap-title">
            <header className="recap-bar">
                <div>
                    <p id="recap-title">One-minute rewind</p>
                    <p className="recap-meta">
                        {sittingLabel} packed into {formatClock(playMs)}
                    </p>
                </div>
                <div className="recap-actions">
                    <button
                        className="btn btn-ghost btn-tiny"
                        disabled={frames.length < 2}
                        onClick={togglePlay}
                        type="button"
                    >
                        {playing ? "Pause" : index >= frames.length - 1 ? "Play again" : "Play"}
                    </button>
                    <button className="btn btn-brass btn-tiny" onClick={onClose} type="button">
                        Back to the table
                    </button>
                </div>
            </header>
            <div className="recap-board">
                <BoardCanvas
                    playback
                    canDraw={false}
                    allowLaser={false}
                    snapshot={scene}
                    remoteScene={null}
                    cursors={[]}
                    onScene={() => undefined}
                    onCursor={() => undefined}
                />
            </div>
            <div className="recap-progress" aria-hidden="true">
                <span style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </div>
        </div>
    );
}
