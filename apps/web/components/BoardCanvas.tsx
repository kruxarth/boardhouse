"use client";

import dynamic from "next/dynamic";
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { MAX_CANVAS_MESSAGE_BYTES } from "@repo/common/constants";
import { downloadBlob } from "../lib/download";
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

type ExportToBlob = (opts: {
    elements: readonly unknown[];
    appState?: Record<string, unknown>;
    files?: Record<string, unknown> | null;
    mimeType?: string;
}) => Promise<Blob>;

const excalidrawLib: {
    reconcile: ReconcileElements | null;
    exportToBlob: ExportToBlob | null;
} = { reconcile: null, exportToBlob: null };

const Excalidraw = dynamic(
    async () => {
        const mod = await import("@excalidraw/excalidraw");
        excalidrawLib.reconcile =
            mod.reconcileElements as unknown as ReconcileElements;
        excalidrawLib.exportToBlob = mod.exportToBlob as unknown as ExportToBlob;
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

function collaboratorsFromCursors(cursors: RemoteCursor[]) {
    const collaborators = new Map();
    for (const cursor of cursors) {
        const tool: PointerTool = cursor.tool === "pointer" ? "pointer" : "laser";
        const button: PointerButton = cursor.button === "down" ? "down" : "up";
        const color = collaboratorColor(cursor.id);
        collaborators.set(cursor.id, {
            id: cursor.id,
            socketId: cursor.id,
            username: cursor.name,
            button,
            userState: "active",
            color,
            pointer: {
                x: cursor.x,
                y: cursor.y,
                tool,
                renderCursor: false,
                laserColor: color.background,
            },
        });
    }
    return collaborators;
}

function paintCollaborators(api: ExcalidrawApi | null, cursors: RemoteCursor[]) {
    if (!api) {
        return;
    }
    api.updateScene({
        collaborators: collaboratorsFromCursors(cursors),
    });
}

function sceneToFrame(
    sceneX: number,
    sceneY: number,
    api: ExcalidrawApi,
    frame: HTMLElement
) {
    const appState = api.getAppState() as {
        scrollX?: number;
        scrollY?: number;
        zoom?: number | { value?: number };
        offsetLeft?: number;
        offsetTop?: number;
    };
    const zoom =
        typeof appState.zoom === "number" ? appState.zoom : (appState.zoom?.value ?? 1);
    const clientX = (sceneX + (appState.scrollX ?? 0)) * zoom + (appState.offsetLeft ?? 0);
    const clientY = (sceneY + (appState.scrollY ?? 0)) * zoom + (appState.offsetTop ?? 0);
    const rect = frame.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
}

function RemotePointers({
    cursors,
    trails,
    api,
    frame,
    tick: _tick,
}: {
    cursors: RemoteCursor[];
    trails: Map<string, { points: { x: number; y: number }[] }>;
    api: ExcalidrawApi | null;
    frame: HTMLDivElement | null;
    tick: number;
}) {
    if (!api || !frame || (cursors.length === 0 && trails.size === 0)) {
        return null;
    }
    const paths = [];
    for (const [id, trail] of trails) {
        if (trail.points.length < 2) {
            continue;
        }
        const color = collaboratorColor(id).background;
        const d = trail.points
            .map((point, index) => {
                const { x, y } = sceneToFrame(point.x, point.y, api, frame);
                return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(" ");
        paths.push(
            <path
                key={id}
                d={d}
                fill="none"
                stroke={color}
                strokeWidth="3.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.92"
            />
        );
    }
    return (
        <div className="remote-pointers" aria-hidden>
            <svg>{paths}</svg>
            {cursors.map((cursor) => {
                const { x, y } = sceneToFrame(cursor.x, cursor.y, api, frame);
                const color = collaboratorColor(cursor.id).background;
                const burning = cursor.tool !== "pointer" && cursor.button === "down";
                return (
                    <div
                        key={cursor.id}
                        className={burning ? "remote-pointer remote-pointer-laser" : "remote-pointer"}
                        style={{ left: x, top: y, color }}
                    >
                        <span className="remote-pointer-dot" />
                        <span className="remote-pointer-name">{cursor.name}</span>
                    </div>
                );
            })}
        </div>
    );
}

function elementId(element: unknown) {
    if (!element || typeof element !== "object" || !("id" in element)) {
        return "";
    }
    return typeof element.id === "string" ? element.id : "";
}

function liveElements(api: ExcalidrawApi) {
    return api.getSceneElementsIncludingDeleted().filter((element) => {
        if (!element || typeof element !== "object" || !("isDeleted" in element)) {
            return true;
        }
        return (element as { isDeleted?: boolean }).isDeleted !== true;
    });
}

function replacePlaybackElements(local: readonly unknown[], remote: unknown[]) {
    const remoteIds = new Set<string>();
    for (const element of remote) {
        const id = elementId(element);
        if (id) {
            remoteIds.add(id);
        }
    }
    const gone = [];
    for (const element of local) {
        const id = elementId(element);
        if (id && !remoteIds.has(id) && element && typeof element === "object") {
            gone.push({ ...element, isDeleted: true });
        }
    }
    return gone.length > 0 ? [...remote, ...gone] : remote;
}

export type BoardHandle = {
    savePng: (filename: string) => Promise<void>;
    saveExcalidraw: (filename: string) => void;
    applyCursor: (cursor: RemoteCursor) => void;
    dropCursor: (id: string) => void;
};

type BoardCanvasProps = {
    canDraw: boolean;
    allowLaser?: boolean;
    markerSlot?: 0 | 1 | null;
    snapshot: unknown;
    remoteScene: unknown;
    cursors: RemoteCursor[];
    playback?: boolean;
    onScene: (payload: unknown) => void;
    onCursor: (x: number, y: number, tool: PointerTool, button: PointerButton) => void;
};

export const BoardCanvas = forwardRef<BoardHandle, BoardCanvasProps>(function BoardCanvas(
    {
        canDraw,
        allowLaser = true,
        markerSlot = null,
        snapshot,
        remoteScene,
        cursors,
        playback = false,
        onScene,
        onCursor,
    },
    ref
) {
    const apiRef = useRef<ExcalidrawApi | null>(null);
    const [apiReady, setApiReady] = useState(false);
    const applyingRef = useRef(false);
    const pendingSceneRef = useRef<unknown>(null);
    const lastPointerButtonRef = useRef<PointerButton>("up");
    const pointerDownRef = useRef(false);
    const lastPointRef = useRef<{ x: number; y: number; tool: PointerTool }>({
        x: 0,
        y: 0,
        tool: "laser",
    });
    const applyTokenRef = useRef(0);
    const sceneGenRef = useRef(0);
    const hydratedRef = useRef(false);
    const lastSceneRef = useRef("");
    const cursorsRef = useRef(cursors);
    const canDrawRef = useRef(canDraw);
    const onSceneRef = useRef(onScene);
    const onCursorRef = useRef(onCursor);
    const frameRef = useRef<HTMLDivElement | null>(null);
    const trailsRef = useRef<Map<string, { points: { x: number; y: number }[] }>>(new Map());
    const fadeTimersRef = useRef<Map<string, number>>(new Map());
    const [overlayTick, setOverlayTick] = useState(0);
    onSceneRef.current = onScene;
    onCursorRef.current = onCursor;
    canDrawRef.current = canDraw;

    const bumpOverlay = useMemo(
        () =>
            throttle(() => {
                setOverlayTick((tick) => tick + 1);
            }, 32),
        []
    );

    const rememberTrail = useCallback(
        (cursor: RemoteCursor) => {
            const fade = fadeTimersRef.current.get(cursor.id);
            if (cursor.tool !== "pointer" && cursor.button === "down") {
                if (fade != null) {
                    window.clearTimeout(fade);
                    fadeTimersRef.current.delete(cursor.id);
                }
                let trail = trailsRef.current.get(cursor.id);
                if (!trail) {
                    trail = { points: [] };
                    trailsRef.current.set(cursor.id, trail);
                }
                const last = trail.points.at(-1);
                if (!last || last.x !== cursor.x || last.y !== cursor.y) {
                    trail.points.push({ x: cursor.x, y: cursor.y });
                    if (trail.points.length > 80) {
                        trail.points.splice(0, trail.points.length - 80);
                    }
                }
                return;
            }
            if (fade != null) {
                return;
            }
            fadeTimersRef.current.set(
                cursor.id,
                window.setTimeout(() => {
                    fadeTimersRef.current.delete(cursor.id);
                    trailsRef.current.delete(cursor.id);
                    bumpOverlay();
                }, 700)
            );
        },
        [bumpOverlay]
    );

    const forgetTrail = useCallback(
        (id: string) => {
            const fade = fadeTimersRef.current.get(id);
            if (fade != null) {
                window.clearTimeout(fade);
                fadeTimersRef.current.delete(id);
            }
            trailsRef.current.delete(id);
            bumpOverlay();
        },
        [bumpOverlay]
    );

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

    const applyScene = useCallback((payload: unknown, replace = false) => {
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
        const elements = replace
            ? replacePlaybackElements(
                  api.getSceneElementsIncludingDeleted(),
                  remoteElements ?? []
              )
            : remoteElements && reconcile
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
        paintCollaborators(api, cursorsRef.current);
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

    const lastInkSlotRef = useRef<0 | 1 | null>(null);
    const syncInk = useCallback((slot: 0 | 1 | null) => {
        const api = apiRef.current;
        if (!api || slot === null || slot === lastInkSlotRef.current) {
            lastInkSlotRef.current = slot;
            return;
        }
        lastInkSlotRef.current = slot;
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
            for (const fade of fadeTimersRef.current.values()) {
                window.clearTimeout(fade);
            }
            fadeTimersRef.current.clear();
            pointerMoveThrottled.cancel();
        };
    }, [pointerMoveThrottled]);

    const applyWhenReady = useCallback(
        (payload: unknown, replace = false) => {
            const generation = ++sceneGenRef.current;
            const attempt = () => {
                if (unmountedRef.current || generation !== sceneGenRef.current) {
                    return;
                }
                const api = apiRef.current;
                const appState = api?.getAppState() as { isLoading?: boolean } | undefined;
                if (!api || appState?.isLoading === true) {
                    window.setTimeout(attempt, 50);
                    return;
                }
                applyScene(payload, replace);
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
        applyWhenReady(snapshot, playback);
    }, [snapshot, playback, applyWhenReady]);

    useEffect(() => {
        if (playback || !remoteScene) {
            return;
        }
        applyWhenReady(remoteScene);
    }, [playback, remoteScene, applyWhenReady]);

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

    useLayoutEffect(() => {
        cursorsRef.current = cursors;
        const api = apiRef.current;
        if (!apiReady || !api) {
            return;
        }
        paintCollaborators(api, cursors);
        for (const cursor of cursors) {
            rememberTrail(cursor);
        }
        const living = new Set(cursors.map((cursor) => cursor.id));
        for (const id of [...trailsRef.current.keys()]) {
            if (!living.has(id)) {
                forgetTrail(id);
            }
        }
        bumpOverlay();
    }, [apiReady, cursors, cursorsKey, bumpOverlay, forgetTrail, rememberTrail]);

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

    useImperativeHandle(ref, () => ({
        applyCursor(cursor) {
            const next = cursorsRef.current.filter((item) => item.id !== cursor.id);
            next.push(cursor);
            cursorsRef.current = next;
            paintCollaborators(apiRef.current, next);
            rememberTrail(cursor);
            bumpOverlay();
        },
        dropCursor(id) {
            const current = cursorsRef.current;
            const existing = current.find((item) => item.id === id);
            if (!existing) {
                forgetTrail(id);
                return;
            }
            const remaining = current.filter((item) => item.id !== id);
            cursorsRef.current = remaining;
            forgetTrail(id);
            paintCollaborators(apiRef.current, [...remaining, { ...existing, button: "up" }]);
            window.setTimeout(() => {
                if (cursorsRef.current.some((item) => item.id === id)) {
                    return;
                }
                paintCollaborators(apiRef.current, cursorsRef.current);
            }, 50);
        },
        async savePng(filename) {
            const api = apiRef.current;
            const exportToBlob = excalidrawLib.exportToBlob;
            if (!api || !exportToBlob) {
                throw new Error("Board is not ready");
            }
            const blob = await exportToBlob({
                elements: liveElements(api),
                appState: {
                    exportBackground: true,
                    viewBackgroundColor: "#ffffff",
                },
                files: api.getFiles(),
                mimeType: "image/png",
            });
            downloadBlob(blob, filename);
        },
        saveExcalidraw(filename) {
            const api = apiRef.current;
            if (!api) {
                throw new Error("Board is not ready");
            }
            downloadBlob(
                new Blob(
                    [
                        JSON.stringify({
                            type: "excalidraw",
                            version: 2,
                            source: "https://excalidraw.com",
                            elements: liveElements(api),
                            appState: { viewBackgroundColor: "#ffffff" },
                            files: api.getFiles(),
                        }),
                    ],
                    { type: "application/json" }
                ),
                filename
            );
        },
    }));

    return (
        <div
            ref={frameRef}
            className={canDraw || playback ? "board-frame" : "board-frame board-watch"}
        >
            <Excalidraw
                name="board-house"
                excalidrawAPI={(api) => {
                    apiRef.current = api as unknown as ExcalidrawApi;
                    setApiReady(true);
                }}
                isCollaborating={!playback}
                viewModeEnabled={playback}
                onScrollChange={() => bumpOverlay()}
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
                        saveAsImage: false,
                        clearCanvas: false,
                        export: false,
                    },
                    welcomeScreen: false,
                }}
                onChange={(elements: unknown, appState: unknown, files: unknown) => {
                    if (!canDraw) {
                        const tool = (appState as { activeTool?: { type?: string } })?.activeTool
                            ?.type;
                        if (tool && tool !== "laser" && tool !== "hand") {
                            syncTool(false, allowLaser);
                        }
                        return;
                    }
                    if (!hydratedRef.current) {
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
                onPointerDown={(
                    activeTool: { type?: string },
                    pointerDownState: { origin?: { x: number; y: number } }
                ) => {
                    if (!canDrawRef.current) {
                        syncTool(false, allowLaser);
                    }
                    const tool: PointerTool =
                        !canDrawRef.current || activeTool.type === "laser" ? "laser" : "pointer";
                    const x = pointerDownState.origin?.x ?? lastPointRef.current.x;
                    const y = pointerDownState.origin?.y ?? lastPointRef.current.y;
                    pointerDownRef.current = true;
                    lastPointerButtonRef.current = "down";
                    lastPointRef.current = { x, y, tool };
                    pointerMoveThrottled.cancel();
                    onCursorRef.current(x, y, tool, "down");
                }}
                onPointerUp={(
                    activeTool: { type?: string },
                    pointerDownState: { lastCoords?: { x: number; y: number } }
                ) => {
                    const tool: PointerTool =
                        !canDrawRef.current || activeTool.type === "laser" ? "laser" : "pointer";
                    const x = pointerDownState.lastCoords?.x ?? lastPointRef.current.x;
                    const y = pointerDownState.lastCoords?.y ?? lastPointRef.current.y;
                    pointerDownRef.current = false;
                    lastPointerButtonRef.current = "up";
                    lastPointRef.current = { x, y, tool };
                    pointerMoveThrottled.cancel();
                    onCursorRef.current(x, y, tool, "up");
                }}
                onPointerUpdate={(payload: { pointer?: Pointer; button?: PointerButton }) => {
                    if (!payload.pointer) {
                        return;
                    }
                    const tool: PointerTool =
                        !canDrawRef.current || payload.pointer.tool === "laser"
                            ? "laser"
                            : "pointer";
                    const button: PointerButton = pointerDownRef.current
                        ? "down"
                        : payload.button === "down"
                          ? "down"
                          : "up";
                    const x = payload.pointer.x;
                    const y = payload.pointer.y;
                    lastPointRef.current = { x, y, tool };
                    const buttonChanged = lastPointerButtonRef.current !== button;
                    lastPointerButtonRef.current = button;
                    if (buttonChanged) {
                        pointerMoveThrottled.cancel();
                        onCursorRef.current(x, y, tool, button);
                        return;
                    }
                    pointerMoveThrottled(x, y, tool, button);
                }}
            />
            <RemotePointers
                cursors={cursorsRef.current}
                trails={trailsRef.current}
                api={apiReady ? apiRef.current : null}
                frame={frameRef.current}
                tick={overlayTick}
            />
        </div>
    );
});
