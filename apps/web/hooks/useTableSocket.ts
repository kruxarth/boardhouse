"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { RoomStatePayload } from "@repo/common/types";
import { ServerMessageSchema } from "@repo/common/types";
import { withUniqueAvatars } from "../components/Avatars";
import type { BoardHandle, RemoteCursor } from "../components/BoardCanvas";
import type { RecapEvent } from "../components/SittingRecap";
import type { AskResult, LiveReaction, MarkerAsk, PendingAsk, TableModel } from "../components/TableShell";
import { clearSession, rememberHostKey, type Session } from "../lib/session";
import { playKnock } from "../lib/sounds";

export type DoorKind =
    | "need-name"
    | "connecting"
    | "waiting"
    | "denied"
    | "full"
    | "expired"
    | "missing"
    | "error"
    | "joined";

type Outgoing = Record<string, unknown>;

function asTable(state: RoomStatePayload): TableModel {
    const taken = new Set<number>();
    const seats = withUniqueAvatars(state.seats, taken);
    const waiters = withUniqueAvatars(state.waiters, taken);
    return {
        slug: state.slug,
        name: state.name,
        accessMode: state.accessMode,
        expiresAt: state.expiresAt,
        hostParticipantId: state.hostParticipantId,
        seats,
        waiters,
        markers: state.markers,
        viaFormerSlug: state.viaFormerSlug,
        usedSeats: state.usedSeats,
        maxSeats: state.maxSeats,
    };
}

export function useTableSocket({
    socket,
    loading,
    session,
    joinToken,
    slug,
    hostKey,
    knockFromHouse,
    boardRef,
    awaitingReplayRef,
    voiceRef,
    router,
    setSession,
    setDoor,
    setDoorMessage,
    setTable,
    setSnapshot,
    setRemoteScene,
    setCursors,
    setAsks,
    setPendingAsk,
    setAskResult,
    setReactions,
    setToast,
    setRecapEvents,
}: {
    socket: WebSocket | null;
    loading: boolean;
    session: Session | null;
    joinToken: string | null;
    slug: string;
    hostKey: string | null;
    knockFromHouse: boolean;
    boardRef: RefObject<BoardHandle | null>;
    awaitingReplayRef: { current: boolean };
    voiceRef: RefObject<{ forceMute: () => Promise<void> }>;
    router: { replace: (href: string) => void };
    setSession: (session: Session | null) => void;
    setDoor: (value: DoorKind | ((current: DoorKind) => DoorKind)) => void;
    setDoorMessage: (value: string | ((current: string) => string)) => void;
    setTable: (value: TableModel | null | ((current: TableModel | null) => TableModel | null)) => void;
    setSnapshot: (value: unknown) => void;
    setRemoteScene: (value: unknown) => void;
    setCursors: (value: RemoteCursor[] | ((current: RemoteCursor[]) => RemoteCursor[])) => void;
    setAsks: (value: MarkerAsk[] | ((current: MarkerAsk[]) => MarkerAsk[])) => void;
    setPendingAsk: (value: PendingAsk | null) => void;
    setAskResult: (value: AskResult | null | ((current: AskResult | null) => AskResult | null)) => void;
    setReactions: (value: LiveReaction[] | ((current: LiveReaction[]) => LiveReaction[])) => void;
    setToast: (value: string | null) => void;
    setRecapEvents: (value: RecapEvent[] | null) => void;
}) {
    const queueRef = useRef<Outgoing[]>([]);
    const joinedRef = useRef(false);
    const socketRef = useRef(socket);
    const markersRef = useRef<[string | null, string | null]>([null, null]);
    const fromHouseRef = useRef(knockFromHouse);
    socketRef.current = socket;

    const send = useCallback((body: Outgoing) => {
        const current = socketRef.current;
        if (joinedRef.current && current && current.readyState === WebSocket.OPEN) {
            current.send(JSON.stringify(body));
            return;
        }
        if (body.type === "canvas" || body.type === "cursor") {
            const index = queueRef.current.findIndex((item) => item.type === body.type);
            if (index >= 0) {
                queueRef.current[index] = body;
                return;
            }
        }
        queueRef.current.push(body);
        if (queueRef.current.length > 40) {
            queueRef.current.shift();
        }
    }, []);

    const flushQueue = useCallback(() => {
        const current = socketRef.current;
        if (!current || current.readyState !== WebSocket.OPEN) {
            return;
        }
        const queued = queueRef.current.splice(0);
        for (const body of queued) {
            current.send(JSON.stringify(body));
        }
    }, []);

    useEffect(() => {
        if (!socket || loading || !session || !joinToken) {
            return;
        }

        const ws = socket;
        const me = session;
        joinedRef.current = false;
        let settled = false;
        let snapshotSeen = false;
        let snapshotWatch: number | undefined;
        setDoor((current) =>
            current === "joined" || current === "waiting" || current === "need-name"
                ? current
                : "connecting"
        );

        ws.send(
            JSON.stringify({
                type: "join",
                roomId: slug,
                hostKey: hostKey || undefined,
                token: joinToken,
                fromHouse: fromHouseRef.current,
            })
        );

        const joinWatch = window.setTimeout(() => {
            if (!settled) {
                setDoor((current) => (current === "connecting" ? "error" : current));
                setDoorMessage((current) => current || "The table line went quiet.");
            }
        }, 10_000);

        const onClose = (event: CloseEvent) => {
            joinedRef.current = false;
            if (event.code === 4000) {
                settled = true;
                setDoor("expired");
                setDoorMessage((current) => current || "This sitting is over");
                return;
            }
            if (event.code === 1008) {
                settled = true;
                clearSession();
                setSession(null);
                setDoor("error");
                setDoorMessage(
                    "That session was rejected. Head back and sit down again with a fresh name."
                );
                return;
            }
            if (event.code === 4001) {
                settled = true;
                setDoor("error");
                setDoorMessage("Connected from another tab. This window stepped out.");
            }
        };

        ws.addEventListener("close", onClose);

        const pushLocalScene = () => {
            let tries = 0;
            const push = () => {
                if (boardRef.current?.broadcastScene()) {
                    return;
                }
                tries += 1;
                if (tries < 20) {
                    window.setTimeout(push, 50);
                }
            };
            push();
        };

        ws.onmessage = (event) => {
            let payload: unknown;
            try {
                payload = JSON.parse(event.data as string);
            } catch {
                return;
            }
            const parsed = ServerMessageSchema.safeParse(payload);
            if (!parsed.success) {
                console.warn("Dropped a table message this page can't read", payload, parsed.error.issues);
                return;
            }
            const message = parsed.data;

            if (message.type === "knock") {
                playKnock();
                return;
            }
            if (message.type === "hello" || message.type === "canvas_ack" || message.type === "participant_joined" || message.type === "left") {
                return;
            }
            if (message.type === "auth_error") {
                settled = true;
                clearSession();
                setSession(null);
                setDoor("error");
                setDoorMessage(
                    "That session was rejected. Head back and sit down again with a fresh name."
                );
                return;
            }
            if (message.type === "joined") {
                settled = true;
                joinedRef.current = true;
                setDoor("joined");
                flushQueue();
                snapshotWatch = window.setTimeout(() => {
                    if (!snapshotSeen) {
                        setSnapshot({ elements: [], files: {} });
                    }
                }, 1500);
                return;
            }
            if (message.type === "waiting") {
                settled = true;
                setDoor("waiting");
                return;
            }
            if (message.type === "denied") {
                settled = true;
                setDoor("denied");
                return;
            }
            if (message.type === "full") {
                settled = true;
                setDoor("full");
                return;
            }
            if (message.type === "expired") {
                settled = true;
                setDoor("expired");
                setDoorMessage(message.message);
                return;
            }
            if (message.type === "missing") {
                settled = true;
                setDoor("missing");
                return;
            }
            if (message.type === "participant_left") {
                const id = message.participantId;
                if (id) {
                    boardRef.current?.dropCursor(id);
                    setCursors((current) => current.filter((item) => item.id !== id));
                }
                return;
            }
            if (message.type === "room_state") {
                markersRef.current = message.markers;
                const state = message;
                setTable(asTable(state));
                const living = new Set([
                    ...state.seats.map((seat) => seat.id),
                    ...state.waiters.map((waiter) => waiter.id),
                ]);
                setCursors((current) => {
                    const next = current.filter((cursor) => living.has(cursor.id));
                    if (next.length !== current.length) {
                        for (const cursor of current) {
                            if (!living.has(cursor.id)) {
                                boardRef.current?.dropCursor(cursor.id);
                            }
                        }
                    }
                    return next;
                });
                if (state.viaFormerSlug === false && state.slug !== slug) {
                    if (hostKey) {
                        rememberHostKey(state.slug, hostKey);
                    }
                    router.replace(`/room/${state.slug}`);
                }
                return;
            }
            if (message.type === "slug_rotated") {
                if (hostKey) {
                    rememberHostKey(message.slug, hostKey);
                }
                router.replace(`/room/${message.slug}`);
                setToast("Guest link changed. Old links have to knock.");
                return;
            }
            if (message.type === "marker_state" || message.type === "marker_ack") {
                markersRef.current = message.slots;
                const slots = message.slots;
                setTable((current) => (current ? { ...current, markers: slots } : current));
                setAsks((current) => current.filter((item) => slots[item.slot] === me.participantId));
                return;
            }
            if (message.type === "marker_asks") {
                setAsks(message.asks.filter((item) => item.requestId));
                return;
            }
            if (message.type === "marker_ask_state") {
                setPendingAsk(message.ask);
                return;
            }
            if (message.type === "marker_ask_done") {
                setAskResult((current) => ({
                    slot: message.slot,
                    outcome: message.outcome,
                    n: (current?.n ?? 0) + 1,
                }));
                return;
            }
            if (message.type === "reaction") {
                const item: LiveReaction = {
                    id: message.id,
                    participantId: message.participantId,
                    emoji: message.emoji,
                };
                setReactions((current) => [...current, item]);
                window.setTimeout(() => {
                    setReactions((current) => current.filter((row) => row.id !== item.id));
                }, 2_800);
                return;
            }
            if (message.type === "canvas_snapshot") {
                snapshotSeen = true;
                if (snapshotWatch) {
                    window.clearTimeout(snapshotWatch);
                    snapshotWatch = undefined;
                }
                setSnapshot(message.payload ?? { elements: [], files: {} });
                const holds =
                    markersRef.current[0] === me.participantId ||
                    markersRef.current[1] === me.participantId;
                if (holds) {
                    pushLocalScene();
                }
                return;
            }
            if (message.type === "canvas") {
                setRemoteScene(message.payload);
                return;
            }
            if (message.type === "cursor") {
                if (message.participantId === me.participantId) {
                    return;
                }
                const cursor: RemoteCursor = {
                    id: message.participantId,
                    name: message.name,
                    x: message.x,
                    y: message.y,
                    tool: message.tool,
                    button: message.button,
                };
                boardRef.current?.applyCursor(cursor);
                setCursors((current) => {
                    const next = current.filter((item) => item.id !== cursor.id);
                    next.push(cursor);
                    return next.slice(-12);
                });
                return;
            }
            if (message.type === "force_mute") {
                void voiceRef.current.forceMute();
                send({ type: "set_muted", muted: true });
                return;
            }
            if (message.type === "replay") {
                if (!awaitingReplayRef.current) {
                    return;
                }
                awaitingReplayRef.current = false;
                const frames = message.events.filter((item) => item.type === "canvas");
                if (frames.length === 0) {
                    setToast("Nothing to rewind yet");
                    return;
                }
                setRecapEvents(message.events);
                return;
            }
            if (message.type === "error") {
                setDoor((current) =>
                    current === "joined" || current === "waiting" ? current : "error"
                );
                setDoorMessage(message.message);
                setToast(message.message);
            }
        };

        return () => {
            window.clearTimeout(joinWatch);
            if (snapshotWatch) {
                window.clearTimeout(snapshotWatch);
            }
            ws.removeEventListener("close", onClose);
            ws.onmessage = null;
        };
    }, [
        socket,
        loading,
        session,
        joinToken,
        slug,
        hostKey,
        router,
        setSession,
        setDoor,
        setDoorMessage,
        setTable,
        setSnapshot,
        setRemoteScene,
        setCursors,
        setAsks,
        setPendingAsk,
        setAskResult,
        setReactions,
        setToast,
        setRecapEvents,
        boardRef,
        awaitingReplayRef,
        voiceRef,
        send,
        flushQueue,
    ]);

    return { send };
}
