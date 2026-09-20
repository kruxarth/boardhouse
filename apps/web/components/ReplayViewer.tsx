"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BoardCanvas } from "./BoardCanvas";

type ReplayEvent = { t: number; type: string; payload: unknown };

type ReplayFile = {
    version?: number;
    startedAt?: string;
    slug?: string;
    events: ReplayEvent[];
};

const EMPTY_SCENE = { elements: [] as unknown[] };

function asScene(payload: unknown) {
    if (Array.isArray(payload)) {
        return { elements: payload };
    }
    if (payload && typeof payload === "object" && "elements" in payload) {
        return payload;
    }
    return EMPTY_SCENE;
}

export function ReplayViewer() {
    const [replay, setReplay] = useState<ReplayFile | null>(null);
    const [index, setIndex] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const indexRef = useRef(0);
    indexRef.current = index;

    const canvasEvents = useMemo(
        () => (replay?.events ?? []).filter((event) => event.type === "canvas"),
        [replay]
    );

    const scene = asScene(canvasEvents[index]?.payload);
    const caption = canvasEvents[index]
        ? `${Math.round(canvasEvents[index]!.t / 1000)}s into the sitting`
        : "Load a sitting you exported";

    useEffect(() => {
        if (!playing || canvasEvents.length < 2) {
            return;
        }
        const startIndex = Math.min(
            Math.max(0, indexRef.current),
            canvasEvents.length - 1
        );
        const originT = canvasEvents[startIndex]?.t ?? 0;
        const originWall = performance.now();
        let frame = 0;
        let stopped = false;
        const tick = () => {
            if (stopped) {
                return;
            }
            const targetT = originT + Math.max(0, performance.now() - originWall);
            let next = startIndex;
            for (let i = startIndex; i < canvasEvents.length; i += 1) {
                if (canvasEvents[i]!.t <= targetT) {
                    next = i;
                } else {
                    break;
                }
            }
            setIndex((current) => (current === next ? current : next));
            if (next >= canvasEvents.length - 1) {
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
    }, [playing, canvasEvents]);

    function togglePlay() {
        if (playing) {
            setPlaying(false);
            return;
        }
        if (canvasEvents.length < 2) {
            return;
        }
        const startAt = index >= canvasEvents.length - 1 ? 0 : index;
        indexRef.current = startAt;
        if (startAt !== index) {
            setIndex(startAt);
        }
        setPlaying(true);
    }

    return (
        <div className="replay-page">
            <header className="replay-head">
                <a href="/">board-house</a>
                <h1>Replay</h1>
                <p>{replay?.slug ?? caption}</p>
                <input
                    type="file"
                    accept="application/json"
                    onChange={async (event) => {
                        const input = event.currentTarget;
                        const file = input.files?.[0];
                        if (!file) {
                            return;
                        }
                        try {
                            const parsed = JSON.parse(await file.text()) as ReplayFile;
                            if (!Array.isArray(parsed.events)) {
                                setError("That file has no events.");
                                return;
                            }
                            setReplay(parsed);
                            setIndex(0);
                            indexRef.current = 0;
                            setPlaying(false);
                            setError(
                                parsed.events.some((item) => item.type === "canvas")
                                    ? null
                                    : "This sitting has no board frames to play back."
                            );
                        } catch {
                            setError("Could not read that file.");
                        } finally {
                            input.value = "";
                        }
                    }}
                />
                {error ? <p className="error">{error}</p> : null}
                {canvasEvents.length > 0 ? (
                    <div className="scrub">
                        <div className="replay-controls">
                            <button
                                className="btn btn-ghost btn-tiny"
                                disabled={canvasEvents.length < 2}
                                onClick={togglePlay}
                                type="button"
                            >
                                {playing ? "Pause" : "Play"}
                            </button>
                            <span>{caption}</span>
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={Math.max(0, canvasEvents.length - 1)}
                            value={index}
                            onChange={(event) => {
                                setPlaying(false);
                                setIndex(Number(event.target.value));
                            }}
                        />
                    </div>
                ) : null}
            </header>
            <div className="replay-board">
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
        </div>
    );
}
