"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_CANVAS_MESSAGE_BYTES } from "@repo/common/constants";
import { throttle } from "../lib/throttle";

import "@excalidraw/excalidraw/index.css";

type ExcalidrawApi = {
    updateScene: (scene: Record<string, unknown>) => void;
    addFiles: (files: unknown) => void;
    setActiveTool: (tool: { type: string }) => void;
    getSceneElementsIncludingDeleted: () => readonly unknown[];
    getFiles: () => Record<string, unknown>;
    getAppState: () => unknown;
};

type ReconcileElements = (
    localElements: readonly unknown[],
    remoteElements: readonly unknown[],
    localAppState: unknown
) => unknown[];

const excalidrawLib: { reconcile: ReconcileElements | null } = { reconcile: null };

const Excalidraw = dynamic(
    async () => {
        const mod = await import("@excalidraw/excalidraw");
        excalidrawLib.reconcile =
            mod.reconcileElements as unknown as ReconcileElements;
        return mod.Excalidraw;
    },
    { ssr: false }
);

type PointerTool = "pointer" | "laser";
type PointerButton = "up" | "down";
type Pointer = { x: number; y: number; tool?: string };

export type RemoteCursor = {
    id: string;
    name: string;
    x: number;
    y: number;
    tool?: PointerTool;
    button?: PointerButton;
    drawing?: boolean;
};

const MAX_SCENE_BYTES = MAX_CANVAS_MESSAGE_BYTES - 64;

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

function serializeScene(elements: unknown, files: unknown) {
    try {
        return JSON.stringify({ elements, files });
    } catch {
        return "";
    }
}

function collaboratorColor(id: string) {
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) {
        hash = (hash + id.charCodeAt(i)) % 2;
    }
    return hash === 0
        ? { background: "#f386a1", stroke: "#1e1e1e" }
        : { background: "#1e1e1e", stroke: "#f386a1" };
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
    onCursor: (x: number, y: number, tool: PointerTool, button: PointerButton) => void;
}) {
    const apiRef = useRef<ExcalidrawApi | null>(null);
    const [apiReady, setApiReady] = useState(false);
    const applyingRef = useRef(false);
    const pendingSceneRef = useRef<unknown>(null);
    const lastPointerButtonRef = useRef<PointerButton>("up");
    const applyTokenRef = useRef(0);
    const sceneGenRef = useRef(0);
    const hydratedRef = useRef(false);
    const lastSceneRef = useRef("");
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

    const pointerMoveThrottled = useMemo(
        () =>
            throttle((x: number, y: number, tool: PointerTool, button: PointerButton) => {
                onCursorRef.current(x, y, tool, button);
            }, 32),
        []
    );

    const finishApplying = useCallback(() => {
        applyingRef.current = false;
        const pending = pendingSceneRef.current;
        if (pending == null) {
            return;
        }
        pendingSceneRef.current = null;
        sendThrottled(pending);
    }, [sendThrottled]);

    const applyScene = useCallback((payload: unknown) => {
        const api = apiRef.current;
        if (!api || !payload || typeof payload !== "object") {
            return;
        }
        const scene = payload as {
            elements?: unknown;
            files?: Record<string, unknown>;
        };
        if (scene.files) {
            const files = Object.values(scene.files);
            if (files.length > 0) {
                api.addFiles(files);
            }
        }
        applyingRef.current = true;
        const applyToken = ++applyTokenRef.current;
        const remoteElements = Array.isArray(scene.elements) ? scene.elements : null;
        const reconcile = excalidrawLib.reconcile;
        const elements =
            remoteElements && reconcile
                ? reconcile(
                      api.getSceneElementsIncludingDeleted(),
                      remoteElements,
                      api.getAppState()
                  )
                : (scene.elements ?? payload);
        api.updateScene({
            elements,
            captureUpdate: "NEVER",
        });
        lastSceneRef.current = serializeScene(elements, api.getFiles());
        window.setTimeout(() => {
            if (applyToken !== applyTokenRef.current) {
                return;
            }
            finishApplying();
        }, 0);
    }, [finishApplying]);

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

    const unmountedRef = useRef(false);

    useEffect(() => {
        unmountedRef.current = false;
        return () => {
            unmountedRef.current = true;
        };
    }, []);

    const applyWhenReady = useCallback(
        (payload: unknown) => {
            const generation = ++sceneGenRef.current;
            const attempt = () => {
                if (unmountedRef.current || generation !== sceneGenRef.current) {
                    return;
                }
                const api = apiRef.current;
                const appState = api?.getAppState() as { isLoading?: boolean } | undefined;
                if (!api || appState?.isLoading !== false) {
                    window.setTimeout(attempt, 50);
                    return;
                }
                applyScene(payload);
                hydratedRef.current = true;
            };
            attempt();
        },
        [applyScene]
    );

    useEffect(() => {
        if (!snapshot) {
            return;
        }
        applyWhenReady(snapshot);
    }, [snapshot, applyWhenReady]);

    useEffect(() => {
        if (!remoteScene) {
            return;
        }
        applyWhenReady(remoteScene);
    }, [remoteScene, applyWhenReady]);

    const cursorsKey = useMemo(
        () =>
            cursors
                .map(
                    (cursor) =>
                        `${cursor.id}:${cursor.x}:${cursor.y}:${cursor.tool ?? ""}:${cursor.button ?? ""}`
                )
                .join("|"),
        [cursors]
    );
    const cursorsRef = useRef(cursors);
    cursorsRef.current = cursors;

    useEffect(() => {
        const api = apiRef.current;
        if (!apiReady || !api) {
            return;
        }
        const collaborators = new Map();
        for (const cursor of cursorsRef.current) {
            const tool: PointerTool =
                cursor.tool ?? (cursor.drawing ? "pointer" : "laser");
            collaborators.set(cursor.id, {
                id: cursor.id,
                username: cursor.name,
                button: cursor.button ?? "up",
                color: collaboratorColor(cursor.id),
                pointer: {
                    x: cursor.x,
                    y: cursor.y,
                    tool,
                    renderCursor: true,
                    laserColor: collaboratorColor(cursor.id).background,
                },
            });
        }
        api.updateScene({
            collaborators,
            captureUpdate: "NEVER",
        });
    }, [apiReady, cursorsKey]);

    useEffect(() => {
        if (!apiReady) {
            return;
        }
        applyingRef.current = true;
        const applyToken = ++applyTokenRef.current;
        syncTool(canDraw, allowLaser);
        syncInk(markerSlot);
        apiRef.current?.updateScene({
            appState: { viewBackgroundColor: "#ffffff" },
            captureUpdate: "NEVER",
        });
        window.setTimeout(() => {
            if (applyToken !== applyTokenRef.current) {
                return;
            }
            finishApplying();
        }, 0);
    }, [apiReady, canDraw, allowLaser, markerSlot, syncTool, syncInk, finishApplying]);

    return (
        <div className="board-frame">
            <Excalidraw
                name="board-house"
                excalidrawAPI={(api) => {
                    apiRef.current = api as unknown as ExcalidrawApi;
                    setApiReady(true);
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
                    if (!canDraw || !hydratedRef.current) {
                        return;
                    }
                    const payload = scenePayload(elements, files);
                    const serialized = JSON.stringify(payload);
                    if (serialized === lastSceneRef.current) {
                        return;
                    }
                    lastSceneRef.current = serialized;
                    if (applyingRef.current) {
                        pendingSceneRef.current = payload;
                        return;
                    }
                    sendThrottled(payload);
                }}
                onPointerUpdate={(payload: { pointer?: Pointer; button?: PointerButton }) => {
                    if (!payload.pointer) {
                        return;
                    }
                    const tool: PointerTool =
                        payload.pointer.tool === "pointer" ? "pointer" : "laser";
                    const button: PointerButton = payload.button === "down" ? "down" : "up";
                    const x = payload.pointer.x;
                    const y = payload.pointer.y;
                    const buttonChanged = lastPointerButtonRef.current !== button;
                    lastPointerButtonRef.current = button;
                    if (buttonChanged) {
                        onCursorRef.current(x, y, tool, button);
                        return;
                    }
                    pointerMoveThrottled(x, y, tool, button);
                }}
            />
        </div>
    );
}
