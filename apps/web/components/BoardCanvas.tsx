"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { throttle } from "../lib/throttle";

import "@excalidraw/excalidraw/index.css";

const Excalidraw = dynamic(
    async () => (await import("@excalidraw/excalidraw")).Excalidraw,
    { ssr: false }
);

type Pointer = { x: number; y: number; tool?: string };

export type RemoteCursor = {
    id: string;
    name: string;
    x: number;
    y: number;
    drawing?: boolean;
};

const MAX_SCENE_BYTES = 1_500_000;

export const MARKER_INK = ["#f386a1", "#1e1e1e"] as const;

function scenePayload(elements: unknown, files: unknown) {
    const withFiles = { elements, files };
    try {
        if (JSON.stringify(withFiles).length <= MAX_SCENE_BYTES) {
            return withFiles;
        }
    } catch {
        // fall through to elements-only
    }
    return { elements };
}

export function BoardCanvas({
    canDraw,
    allowLaser = true,
    markerSlot = null,
    snapshot,
    remoteScene,
    cursors,
    onScene,
    onCursor,
}: {
    canDraw: boolean;
    allowLaser?: boolean;
    markerSlot?: 0 | 1 | null;
    snapshot: unknown;
    remoteScene: unknown;
    cursors: RemoteCursor[];
    onScene: (payload: unknown) => void;
    onCursor: (x: number, y: number) => void;
}) {
    const apiRef = useRef<{
        updateScene: (scene: Record<string, unknown>) => void;
        addFiles: (files: unknown) => void;
        setActiveTool: (tool: { type: string }) => void;
    } | null>(null);
    const applyingRef = useRef(false);
    const lastSentRef = useRef("");
    const onSceneRef = useRef(onScene);
    const onCursorRef = useRef(onCursor);
    onSceneRef.current = onScene;
    onCursorRef.current = onCursor;

    const sendThrottled = useMemo(
        () =>
            throttle((payload: unknown) => {
                onSceneRef.current(payload);
            }, 80),
        []
    );

    const pointerThrottled = useMemo(
        () =>
            throttle((x: number, y: number) => {
                onCursorRef.current(x, y);
            }, 80),
        []
    );

    const applyScene = useCallback((payload: unknown) => {
        if (!apiRef.current || !payload || typeof payload !== "object") {
            return;
        }
        const scene = payload as { elements?: unknown; files?: Record<string, unknown> };
        applyingRef.current = true;
        if (scene.files) {
            apiRef.current.addFiles(Object.values(scene.files));
        }
        apiRef.current.updateScene({
            elements: scene.elements ?? payload,
            captureUpdate: "NEVER",
        });
        window.setTimeout(() => {
            applyingRef.current = false;
        }, 0);
    }, []);

    const syncTool = useCallback((drawing: boolean, laser: boolean) => {
        const api = apiRef.current;
        if (!api || drawing) {
            return;
        }
        api.setActiveTool({ type: laser ? "laser" : "hand" });
    }, []);

    const syncInk = useCallback((slot: 0 | 1 | null) => {
        const api = apiRef.current;
        if (!api || slot === null) {
            return;
        }
        api.updateScene({
            appState: {
                currentItemStrokeColor: MARKER_INK[slot],
            },
            captureUpdate: "NEVER",
        });
    }, []);

    useEffect(() => {
        if (snapshot) {
            applyScene(snapshot);
        }
    }, [snapshot, applyScene]);

    useEffect(() => {
        if (remoteScene) {
            applyScene(remoteScene);
        }
    }, [remoteScene, applyScene]);

    useEffect(() => {
        if (!apiRef.current) {
            return;
        }
        const collaborators = new Map();
        for (const cursor of cursors) {
            collaborators.set(cursor.id, {
                username: cursor.name,
                pointer: {
                    x: cursor.x,
                    y: cursor.y,
                    tool: cursor.drawing ? "pointer" : "laser",
                },
            });
        }
        apiRef.current.updateScene({ collaborators });
    }, [cursors]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            syncTool(canDraw, allowLaser);
            syncInk(markerSlot);
            apiRef.current?.updateScene({
                appState: { viewBackgroundColor: "#ffffff" },
                captureUpdate: "NEVER",
            });
        }, 0);
        return () => window.clearTimeout(timer);
    }, [canDraw, allowLaser, markerSlot, syncTool, syncInk]);

    return (
        <div className="board-frame">
            <Excalidraw
                name="board-house"
                excalidrawAPI={(api) => {
                    apiRef.current = api as typeof apiRef.current;
                }}
                isCollaborating
                viewModeEnabled={!canDraw}
                aiEnabled={false}
                initialData={{
                    appState: {
                        viewBackgroundColor: "#ffffff",
                        currentItemStrokeColor:
                            markerSlot === null ? "#1e1e1e" : MARKER_INK[markerSlot],
                    },
                }}
                zenModeEnabled={false}
                theme="light"
                UIOptions={{
                    canvasActions: {
                        loadScene: false,
                        saveToActiveFile: false,
                        toggleTheme: false,
                        changeViewBackgroundColor: false,
                    },
                    welcomeScreen: false,
                }}
                onChange={(elements: unknown, _appState: unknown, files: unknown) => {
                    if (!canDraw || applyingRef.current) {
                        return;
                    }
                    const payload = scenePayload(elements, files);
                    const serialized = JSON.stringify(payload);
                    if (serialized === lastSentRef.current) {
                        return;
                    }
                    lastSentRef.current = serialized;
                    sendThrottled(payload);
                }}
                onPointerUpdate={(payload: { pointer?: Pointer }) => {
                    if (!payload.pointer) {
                        return;
                    }
                    pointerThrottled(payload.pointer.x, payload.pointer.y);
                }}
            />
        </div>
    );
}
