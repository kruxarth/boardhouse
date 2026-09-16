"use client";

import { useMemo, useState } from "react";
import { BoardCanvas } from "./BoardCanvas";

type ReplayFile = {
    version?: number;
    startedAt?: string;
    slug?: string;
    events: Array<{ t: number; type: string; payload: unknown }>;
};

export function ReplayViewer() {
    const [replay, setReplay] = useState<ReplayFile | null>(null);
    const [index, setIndex] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const canvasEvents = useMemo(
        () => (replay?.events ?? []).filter((event) => event.type === "canvas"),
        [replay]
    );

    const scene = canvasEvents[index]?.payload ?? { elements: [] };
    const caption = canvasEvents[index]
        ? `${Math.round((canvasEvents[index]!.t) / 1000)}s into the sitting`
        : "Load a board-house replay JSON";

    return (
        <div className="replay-page">
            <header className="replay-head">
                <a href="/">board-house</a>
                <h1>Replay</h1>
                <p>{replay?.slug ? replay.slug : caption}</p>
                <input
                    type="file"
                    accept="application/json"
                    onChange={async (event) => {
                        const file = event.target.files?.[0];
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
                            setError(null);
                        } catch {
                            setError("Could not read that file.");
                        }
                    }}
                />
                {error ? <p className="error">{error}</p> : null}
                {canvasEvents.length > 0 ? (
                    <label className="scrub">
                        {caption}
                        <input
                            type="range"
                            min={0}
                            max={canvasEvents.length - 1}
                            value={index}
                            onChange={(event) => setIndex(Number(event.target.value))}
                        />
                    </label>
                ) : null}
            </header>
            <div className="replay-board">
                <BoardCanvas
                    canDraw={false}
                    allowLaser={false}
                    snapshot={scene}
                    remoteScene={scene}
                    cursors={[]}
                    onScene={() => undefined}
                    onCursor={() => undefined}
                />
            </div>
        </div>
    );
}
