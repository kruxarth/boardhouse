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

export const MARKER_INK = ["#E23A74", "#1D2946"] as const;
export const BOARD_BACKGROUND = "#F3F6F8";

function serializeScene(elements: unknown, files: unknown) {
    try {
        return JSON.stringify({ elements, files });
    } catch {
        return "";
    }
}

function jsonSize(value: unknown) {
    try {
        return new TextEncoder().encode(JSON.stringify(value)).length;
    } catch {
        return Number.POSITIVE_INFINITY;
    }
}

function readElement(element: unknown) {
    if (!element || typeof element !== "object") {
        return null;
    }
    const record = element as { id?: unknown; version?: unknown };
    if (typeof record.id !== "string" || record.id.length === 0) {
        return null;
    }
    return {
        id: record.id,
        version: typeof record.version === "number" ? record.version : 0,
    };
}

function packScene(elements: unknown[], files: Record<string, unknown>) {
    const full = { elements, files };
    if (jsonSize(full) <= MAX_SCENE_BYTES) {
        return full;
    }
    const fitted: Record<string, unknown> = {};
    for (const [id, file] of Object.entries(files)) {
        const candidate = { elements, files: { ...fitted, [id]: file } };
        if (jsonSize(candidate) > MAX_SCENE_BYTES) {
            continue;
        }
        fitted[id] = file;
    }
    if (jsonSize({ elements, files: fitted }) <= MAX_SCENE_BYTES) {
        return { elements, files: fitted };
    }
    return { elements, files: {} as Record<string, unknown> };
}

function collaboratorColor(id: string) {
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) {
        hash = (hash + id.charCodeAt(i)) % 2;
    }
    return hash === 0
        ? { background: MARKER_INK[0], stroke: MARKER_INK[1] }
        : { background: MARKER_INK[1], stroke: MARKER_INK[0] };
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

function readAppState(api: ExcalidrawApi | null) {
    if (!api) {
        return null;
    }
    return api.getAppState() as {
        scrollX?: number;
        scrollY?: number;
        zoom?: number | { value?: number };
        offsetLeft?: number;
        offsetTop?: number;
        activeTool?: { type?: string };
    };
}

function zoomOf(appState: { zoom?: number | { value?: number } } | null) {
    if (!appState) {
        return 1;
    }
    return typeof appState.zoom === "number" ? appState.zoom : (appState.zoom?.value ?? 1);
}

function clientToScene(clientX: number, clientY: number, api: ExcalidrawApi | null) {
    const appState = readAppState(api);
    const zoom = zoomOf(appState);
    return {
        x: (clientX - (appState?.offsetLeft ?? 0)) / zoom - (appState?.scrollX ?? 0),
        y: (clientY - (appState?.offsetTop ?? 0)) / zoom - (appState?.scrollY ?? 0),
        activeTool: appState?.activeTool?.type,
    };
}

function isBoardChrome(target: EventTarget | null) {
    return target instanceof Element
        ? Boolean(
              target.closest(
                  "button, a, input, textarea, select, label, .App-toolbar, .App-toolbar-container, .shapes-section, .App-menu, .App-menu__left, .zoom-actions, .undo-redo-buttons, .sidebar, .ToolIcon"
              )
          )
        : false;
}

function sceneToFrame(
    sceneX: number,
    sceneY: number,
    api: ExcalidrawApi,
    frame: HTMLElement
) {
    const appState = readAppState(api);
    const zoom = zoomOf(appState);
    const clientX = (sceneX + (appState?.scrollX ?? 0)) * zoom + (appState?.offsetLeft ?? 0);
    const clientY = (sceneY + (appState?.scrollY ?? 0)) * zoom + (appState?.offsetTop ?? 0);
    const rect = frame.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
}

function RemotePointers({
    cursors,
    trails,
    api,
    frame,
    tick,
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
        <div className="remote-pointers" data-tick={tick} aria-hidden>
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
    /** Send the whole local scene. Used after a reconnect so strokes drawn offline are not dropped. */
    broadcastScene: () => boolean;
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
    onDeniedDraw?: () => void;
    onDrawing?: (drawing: boolean) => void;
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
        onDeniedDraw,
        onDrawing,
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
    const sentVersionsRef = useRef(new Map<string, number>());
    const sentFileIdsRef = useRef(new Set<string>());
    const latestSceneRef = useRef<{ elements: readonly unknown[]; files: Record<string, unknown> } | null>(
        null
    );
    const cursorsRef = useRef(cursors);
    const canDrawRef = useRef(canDraw);
    const onSceneRef = useRef(onScene);
    const onCursorRef = useRef(onCursor);
    const onDeniedRef = useRef(onDeniedDraw);
    const onDrawingRef = useRef(onDrawing);
    const denyDragRef = useRef<{ x: number; y: number; sent: boolean } | null>(null);
    const frameRef = useRef<HTMLDivElement | null>(null);
    const trailsRef = useRef<Map<string, { points: { x: number; y: number }[] }>>(new Map());
    const fadeTimersRef = useRef<Map<string, number>>(new Map());
    const [overlayTick, setOverlayTick] = useState(0);
    onSceneRef.current = onScene;
    onCursorRef.current = onCursor;
    onDeniedRef.current = onDeniedDraw;
    onDrawingRef.current = onDrawing;
    canDrawRef.current = canDraw;

    const publishDrawing = (button: PointerButton, tool: PointerTool) => {
        onDrawingRef.current?.(canDrawRef.current && button === "down" && tool === "pointer");
    };

    const noteDeniedDrag = (x: number, y: number) => {
        if (canDrawRef.current) {
            denyDragRef.current = null;
            return;
        }
        const drag = denyDragRef.current;
        if (!drag) {
            denyDragRef.current = { x, y, sent: false };
            return;
        }
        if (drag.sent) {
            return;
        }
        if (Math.hypot(x - drag.x, y - drag.y) > 8) {
            drag.sent = true;
            onDeniedRef.current?.();
        }
    };

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

    const flushPublishRef = useRef<(force?: boolean) => void>(() => {});
    flushPublishRef.current = (force = false) => {
        const latest = latestSceneRef.current;
        if (!latest || (!force && !canDrawRef.current)) {
            return;
        }
        const changed: unknown[] = [];
        for (const element of latest.elements) {
            const read = readElement(element);
            if (!read) {
                continue;
            }
            const sent = sentVersionsRef.current.get(read.id);
            if (sent === undefined || read.version > sent) {
                changed.push(element);
            }
        }
        const nextFiles: Record<string, unknown> = {};
        for (const [id, file] of Object.entries(latest.files)) {
            if (!sentFileIdsRef.current.has(id)) {
                nextFiles[id] = file;
            }
        }
        lastSceneRef.current = serializeScene(latest.elements, latest.files);
        if (changed.length === 0 && Object.keys(nextFiles).length === 0) {
            return;
        }
        const payload = packScene(changed, nextFiles);
        for (const element of payload.elements) {
            const read = readElement(element);
            if (read) {
                sentVersionsRef.current.set(read.id, read.version);
            }
        }
        for (const id of Object.keys(payload.files)) {
            sentFileIdsRef.current.add(id);
        }
        onSceneRef.current(payload);
    };

    const sendThrottled = useMemo(
        () =>
            throttle(() => {
                flushPublishRef.current();
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
        const pending = pendingSceneRef.current as {
            elements?: readonly unknown[];
            files?: Record<string, unknown>;
        } | null;
        pendingSceneRef.current = null;
        if (!pending) {
            return;
        }
        latestSceneRef.current = {
            elements: pending.elements ?? [],
            files: pending.files ?? {},
        };
        sendThrottled();
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
        const reconciled = Array.isArray(elements) ? elements : [];
        const localVersion = new Map<string, number>();
        for (const element of reconciled) {
            const read = readElement(element);
            if (read) {
                localVersion.set(read.id, read.version);
            }
        }
        for (const element of remoteElements ?? []) {
            const read = readElement(element);
            if (!read) {
                continue;
            }
            const local = localVersion.get(read.id);
            if (local !== undefined && local > read.version) {
                continue;
            }
            const sent = sentVersionsRef.current.get(read.id) ?? -1;
            if (read.version > sent) {
                sentVersionsRef.current.set(read.id, read.version);
            }
        }
        if (scene.files) {
            for (const id of Object.keys(scene.files)) {
                sentFileIdsRef.current.add(id);
            }
        }
        lastSceneRef.current = serializeScene(reconciled, api.getFiles());
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
        const fadeTimers = fadeTimersRef.current;
        unmountedRef.current = false;
        return () => {
            unmountedRef.current = true;
            for (const fade of fadeTimers.values()) {
                window.clearTimeout(fade);
            }
            fadeTimers.clear();
            pointerMoveThrottled.cancel();
            sendThrottled.cancel();
        };
    }, [pointerMoveThrottled, sendThrottled]);

    useEffect(() => {
        if (playback || !apiReady) {
            return;
        }
        const frame = frameRef.current;
        if (!frame) {
            return;
        }
        frame.dataset.laserListen = "1";

        const toolFor = (activeTool?: string): PointerTool =>
            !canDrawRef.current || activeTool === "laser" ? "laser" : "pointer";

        const emit = (clientX: number, clientY: number, button: PointerButton, immediate: boolean) => {
            const scene = clientToScene(clientX, clientY, apiRef.current);
            const tool = toolFor(scene.activeTool);
            lastPointRef.current = { x: scene.x, y: scene.y, tool };
            lastPointerButtonRef.current = button;
            if (immediate) {
                pointerMoveThrottled.cancel();
                onCursorRef.current(scene.x, scene.y, tool, button);
                return;
            }
            pointerMoveThrottled(scene.x, scene.y, tool, button);
        };

        const onDown = (event: PointerEvent) => {
            if (event.isPrimary === false || event.button !== 0 || isBoardChrome(event.target)) {
                return;
            }
            if (!canDrawRef.current) {
                syncTool(false, true);
            }
            pointerDownRef.current = true;
            emit(event.clientX, event.clientY, "down", true);
        };
        const onMove = (event: PointerEvent) => {
            if (event.isPrimary === false || isBoardChrome(event.target)) {
                return;
            }
            const button: PointerButton = pointerDownRef.current ? "down" : "up";
            emit(event.clientX, event.clientY, button, false);
        };
        const onUp = (event: PointerEvent) => {
            if (event.isPrimary === false || !pointerDownRef.current) {
                return;
            }
            pointerDownRef.current = false;
            emit(event.clientX, event.clientY, "up", true);
        };

        frame.addEventListener("pointerdown", onDown, true);
        frame.addEventListener("pointermove", onMove, true);
        window.addEventListener("pointerup", onUp, true);
        window.addEventListener("pointercancel", onUp, true);
        return () => {
            frame.removeEventListener("pointerdown", onDown, true);
            frame.removeEventListener("pointermove", onMove, true);
            window.removeEventListener("pointerup", onUp, true);
            window.removeEventListener("pointercancel", onUp, true);
        };
    }, [apiReady, playback, pointerMoveThrottled, syncTool]);

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
            appState: { viewBackgroundColor: BOARD_BACKGROUND },
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
        broadcastScene() {
            const api = apiRef.current;
            if (!api) {
                return false;
            }
            sentVersionsRef.current.clear();
            sentFileIdsRef.current.clear();
            latestSceneRef.current = {
                elements: api.getSceneElementsIncludingDeleted(),
                files: api.getFiles(),
            };
            lastSceneRef.current = "";
            flushPublishRef.current(true);
            return true;
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
                    viewBackgroundColor: BOARD_BACKGROUND,
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
                            appState: { viewBackgroundColor: BOARD_BACKGROUND },
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
                        viewBackgroundColor: BOARD_BACKGROUND,
                        currentItemStrokeColor:
                            markerSlot === null ? MARKER_INK[1] : MARKER_INK[markerSlot],
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
                    const api = apiRef.current;
                    const list = api
                        ? api.getSceneElementsIncludingDeleted()
                        : Array.isArray(elements)
                          ? elements
                          : [];
                    const fileMap =
                        files && typeof files === "object" && !Array.isArray(files)
                            ? (files as Record<string, unknown>)
                            : {};
                    if (applyingRef.current) {
                        pendingSceneRef.current = { elements: list, files: fileMap };
                        return;
                    }
                    const serialized = serializeScene(list, fileMap);
                    if (serialized === lastSceneRef.current) {
                        return;
                    }
                    latestSceneRef.current = { elements: list, files: fileMap };
                    sendThrottled();
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
                    noteDeniedDrag(x, y);
                    publishDrawing("down", tool);
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
                    denyDragRef.current = null;
                    publishDrawing("up", tool);
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
                    if (pointerDownRef.current) {
                        noteDeniedDrag(x, y);
                    }
                    publishDrawing(button, tool);
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
