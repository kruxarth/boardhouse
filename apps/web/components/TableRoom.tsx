"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AskOutcome, RoomStatePayload } from "@repo/common/types";
import { useLocalSession } from "../hooks/useLocalSession";
import { useSocket } from "../hooks/useSocket";
import { useVoice } from "../hooks/useVoice";
import { createSession, fetchRoom, isUnauthorizedError, refreshSession } from "../lib/api";
import { rememberHostKey, readHostKey, clearSession } from "../lib/session";
import type { BoardHandle, RemoteCursor } from "./BoardCanvas";
import { DoorScreen } from "./DoorScreen";
import { NameGate } from "./NameGate";
import { avatarFromId, withUniqueAvatars } from "./Avatars";
import type { RecapEvent } from "./SittingRecap";
import {
    doorCopy,
    TableShell,
    type AskResult,
    type LiveReaction,
    type MarkerAsk,
    type PendingAsk,
    type TableModel,
} from "./TableShell";

const REACTION_LIFE_MS = 2_800;

type DoorKind =
    | "need-name"
    | "connecting"
    | "waiting"
    | "denied"
    | "full"
    | "expired"
    | "missing"
    | "error"
    | "joined";

function asTable(state: RoomStatePayload): TableModel {
    const taken = new Set<number>();
    const seats = withUniqueAvatars(state.seats ?? [], taken);
    const waiters = withUniqueAvatars(state.waiters ?? [], taken);
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

export function TableRoom({
    slug,
    hostKeyFromUrl,
    knockFromHouse,
}: {
    slug: string;
    hostKeyFromUrl: string | null;
    knockFromHouse: boolean;
}) {
    const router = useRouter();
    const { session, setSession, ready } = useLocalSession();
    const [door, setDoor] = useState<DoorKind>("connecting");
    const [doorMessage, setDoorMessage] = useState("");
    const [table, setTable] = useState<TableModel | null>(null);
    const [snapshot, setSnapshot] = useState<unknown>(null);
    const [remoteScene, setRemoteScene] = useState<unknown>(null);
    const [cursors, setCursors] = useState<RemoteCursor[]>([]);
    const [asks, setAsks] = useState<MarkerAsk[]>([]);
    const [pendingAsk, setPendingAsk] = useState<PendingAsk | null>(null);
    const [askResult, setAskResult] = useState<AskResult | null>(null);
    const [reactions, setReactions] = useState<LiveReaction[]>([]);
    const [now, setNow] = useState(Date.now());
    const [toast, setToast] = useState<string | null>(null);
    const [namePending, setNamePending] = useState(false);
    const [recapEvents, setRecapEvents] = useState<RecapEvent[] | null>(null);
    const boardRef = useRef<BoardHandle | null>(null);
    const awaitingReplayRef = useRef(false);
    const fromHouseRef = useRef(knockFromHouse);
    const hostKey = hostKeyFromUrl || (ready ? readHostKey(slug) : null);
    const [joinToken, setJoinToken] = useState<string | null>(null);
    const preparedTokenRef = useRef<string | null>(null);
    const { socket, loading, failed } = useSocket(joinToken);
    const joined = door === "joined";
    const voice = useVoice({
        enabled: joined,
        token: joinToken,
        slug: table?.slug ?? slug,
    });
    const voiceRef = useRef(voice);
    voiceRef.current = voice;
    const slugRef = useRef(table?.slug ?? slug);
    slugRef.current = table?.slug ?? slug;

    const canDraw = useMemo(() => {
        if (!session || !table) {
            return false;
        }
        return table.markers[0] === session.participantId || table.markers[1] === session.participantId;
    }, [session, table]);
    const remoteCursors = useMemo(
        () => cursors.filter((cursor) => cursor.id !== session?.participantId),
        [cursors, session?.participantId]
    );

    useEffect(() => {
        if (hostKeyFromUrl) {
            rememberHostKey(slug, hostKeyFromUrl);
        }
    }, [hostKeyFromUrl, slug]);

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (failed) {
            setDoor("error");
            setDoorMessage("Could not reach the table line.");
        }
    }, [failed]);

    useEffect(() => {
        if (!ready) {
            return;
        }
        if (!session) {
            preparedTokenRef.current = null;
            setJoinToken(null);
            setDoor((current) =>
                current === "denied" ||
                current === "full" ||
                current === "expired" ||
                current === "missing" ||
                current === "error"
                    ? current
                    : "need-name"
            );
            return;
        }
        if (preparedTokenRef.current === session.token) {
            setJoinToken(session.token);
            return;
        }

        const tokenToRefresh = session.token;
        let cancelled = false;
        void (async () => {
            try {
                const next = await refreshSession(tokenToRefresh);
                if (cancelled) {
                    return;
                }
                preparedTokenRef.current = next.token;
                setSession(next);
                setJoinToken(next.token);
            } catch (error) {
                if (cancelled) {
                    return;
                }
                if (isUnauthorizedError(error)) {
                    clearSession();
                    preparedTokenRef.current = null;
                    setSession(null);
                    setJoinToken(null);
                    setDoor("need-name");
                    return;
                }
                preparedTokenRef.current = tokenToRefresh;
                setJoinToken(tokenToRefresh);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [ready, session, setSession]);

    useEffect(() => {
        let cancelled = false;
        fetchRoom(slug).then((result) => {
            if (cancelled) {
                return;
            }
            if (!result.ok) {
                setDoor((current) =>
                    current === "joined" || current === "waiting"
                        ? current
                        : result.status === "error"
                          ? "error"
                          : result.status
                );
            }
        });
        return () => {
            cancelled = true;
        };
    }, [slug]);

    useEffect(() => {
        if (!socket || loading || !session || !joinToken) {
            return;
        }

        const ws = socket;
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
                setDoor((current) =>
                    current === "connecting" ? "error" : current
                );
                setDoorMessage((current) => current || "The table line went quiet.");
            }
        }, 10_000);

        const onClose = (event: CloseEvent) => {
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

        ws.onmessage = (event) => {
            let payload: unknown;
            try {
                payload = JSON.parse(event.data as string);
            } catch {
                return;
            }
            if (!payload || typeof payload !== "object" || !("type" in payload)) {
                return;
            }
            const message = payload as Record<string, unknown>;
            const type = message.type;

            if (type === "hello") {
                return;
            }
            if (type === "auth_error") {
                settled = true;
                clearSession();
                setSession(null);
                setDoor("error");
                setDoorMessage(
                    "That session was rejected. Head back and sit down again with a fresh name."
                );
                return;
            }
            if (type === "joined") {
                settled = true;
                setDoor("joined");
                snapshotWatch = window.setTimeout(() => {
                    if (!snapshotSeen) {
                        setSnapshot({ elements: [], files: {} });
                    }
                }, 1500);
                return;
            }
            if (type === "waiting") {
                settled = true;
                setDoor("waiting");
                return;
            }
            if (type === "denied") {
                settled = true;
                setDoor("denied");
                return;
            }
            if (type === "full") {
                settled = true;
                setDoor("full");
                return;
            }
            if (type === "expired") {
                settled = true;
                setDoor("expired");
                setDoorMessage(String(message.message ?? ""));
                return;
            }
            if (type === "missing") {
                settled = true;
                setDoor("missing");
                return;
            }
            if (type === "participant_left") {
                const id = String(message.participantId ?? "");
                if (id) {
                    boardRef.current?.dropCursor(id);
                    setCursors((current) => current.filter((item) => item.id !== id));
                }
                return;
            }
            if (type === "room_state") {
                const state = message as unknown as RoomStatePayload;
                setTable(asTable(state));
                const living = new Set([
                    ...(state.seats ?? []).map((seat) => seat.id),
                    ...(state.waiters ?? []).map((waiter) => waiter.id),
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
                    const next = hostKey
                        ? `/room/${state.slug}?host=${hostKey}`
                        : `/room/${state.slug}`;
                    if (hostKey) {
                        rememberHostKey(state.slug, hostKey);
                    }
                    router.replace(next);
                }
                return;
            }
            if (type === "slug_rotated") {
                const nextSlug = String(message.slug ?? "");
                if (nextSlug) {
                    if (hostKey) {
                        rememberHostKey(nextSlug, hostKey);
                    }
                    router.replace(hostKey ? `/room/${nextSlug}?host=${hostKey}` : `/room/${nextSlug}`);
                    setToast("Guest link changed. Old links have to knock.");
                }
                return;
            }
            if (type === "marker_state" || type === "marker_ack") {
                const slots = message.slots as [string | null, string | null] | undefined;
                if (slots) {
                    setTable((current) => (current ? { ...current, markers: slots } : current));
                    setAsks((current) =>
                        current.filter((item) => slots[item.slot] === session.participantId)
                    );
                }
                return;
            }
            if (type === "marker_asks") {
                const incoming = Array.isArray(message.asks) ? message.asks : [];
                setAsks(
                    incoming
                        .map((item) => {
                            const row = item as Record<string, unknown>;
                            const parsed: MarkerAsk = {
                                requestId: String(row.requestId ?? ""),
                                fromParticipantId: String(row.fromParticipantId ?? ""),
                                fromName: String(row.fromName ?? "Someone"),
                                fromAvatar: Number.isFinite(Number(row.fromAvatar))
                                    ? Number(row.fromAvatar)
                                    : avatarFromId(String(row.fromParticipantId ?? "")),
                                slot: row.slot === 1 ? 1 : 0,
                                expiresAt: String(row.expiresAt ?? ""),
                            };
                            return parsed;
                        })
                        .filter((item) => item.requestId)
                );
                return;
            }
            if (type === "marker_ask_state") {
                const row = message.ask as Record<string, unknown> | null | undefined;
                setPendingAsk(
                    row
                        ? {
                              requestId: String(row.requestId ?? ""),
                              slot: row.slot === 1 ? 1 : 0,
                              holderId: String(row.holderId ?? ""),
                              holderName: String(row.holderName ?? "someone"),
                              expiresAt: String(row.expiresAt ?? ""),
                          }
                        : null
                );
                return;
            }
            if (type === "marker_ask_done") {
                const outcome = String(message.outcome ?? "lapsed") as AskOutcome;
                setAskResult((current) => ({
                    slot: message.slot === 1 ? 1 : 0,
                    outcome,
                    n: (current?.n ?? 0) + 1,
                }));
                return;
            }
            if (type === "reaction") {
                const item: LiveReaction = {
                    id: String(message.id ?? Math.random()),
                    participantId: String(message.participantId ?? ""),
                    emoji: String(message.emoji ?? ""),
                };
                setReactions((current) => [...current, item]);
                window.setTimeout(() => {
                    setReactions((current) => current.filter((row) => row.id !== item.id));
                }, REACTION_LIFE_MS);
                return;
            }
            if (type === "canvas_snapshot") {
                snapshotSeen = true;
                if (snapshotWatch) {
                    window.clearTimeout(snapshotWatch);
                    snapshotWatch = undefined;
                }
                setSnapshot(message.payload ?? { elements: [], files: {} });
                return;
            }
            if (type === "canvas") {
                setRemoteScene(message.payload);
                return;
            }
            if (type === "cursor") {
                const id = String(message.participantId);
                if (id === session?.participantId) {
                    return;
                }
                const cursor: RemoteCursor = {
                    id,
                    name: String(message.name ?? ""),
                    x: Number(message.x),
                    y: Number(message.y),
                    tool: message.tool === "pointer" ? "pointer" : "laser",
                    button: message.button === "down" ? "down" : "up",
                };
                boardRef.current?.applyCursor(cursor);
                setCursors((current) => {
                    const next = current.filter((item) => item.id !== id);
                    next.push(cursor);
                    return next.slice(-12);
                });
                return;
            }
            if (type === "force_mute") {
                void voiceRef.current.forceMute();
                send({ type: "set_muted", muted: true });
                return;
            }
            if (type === "replay") {
                if (!awaitingReplayRef.current) {
                    return;
                }
                awaitingReplayRef.current = false;
                const incoming = Array.isArray(message.events) ? message.events : [];
                const frames = incoming.filter((item) => {
                    if (!item || typeof item !== "object" || !("type" in item)) {
                        return false;
                    }
                    return (item as RecapEvent).type === "canvas";
                });
                if (frames.length === 0) {
                    setToast("Nothing to rewind yet");
                    return;
                }
                setRecapEvents(
                    incoming.map((item) => {
                        const row = item as Record<string, unknown>;
                        const parsed: RecapEvent = {
                            t: Number(row.t) || 0,
                            type: String(row.type ?? ""),
                            payload: row.payload,
                        };
                        return parsed;
                    })
                );
                return;
            }
            if (type === "error") {
                const text = String(message.message ?? "Could not sit down");
                setDoor((current) =>
                    current === "joined" || current === "waiting" ? current : "error"
                );
                setDoorMessage(text);
                setToast(text);
            }
        };

        function send(body: Record<string, unknown>) {
            ws.send(JSON.stringify(body));
        }

        return () => {
            window.clearTimeout(joinWatch);
            if (snapshotWatch) {
                window.clearTimeout(snapshotWatch);
            }
            ws.removeEventListener("close", onClose);
            ws.onmessage = null;
        };
    }, [socket, loading, session, joinToken, slug, hostKey, router, setSession]);

    useEffect(() => {
        if (!toast) {
            return;
        }
        const timer = window.setTimeout(() => setToast(null), 2400);
        return () => window.clearTimeout(timer);
    }, [toast]);

    function send(body: Record<string, unknown>) {
        socket?.send(JSON.stringify(body));
    }

    async function handleName(name: string) {
        setNamePending(true);
        try {
            const next = await createSession(name);
            preparedTokenRef.current = next.token;
            setSession(next);
            setJoinToken(next.token);
            setDoor("connecting");
        } catch {
            setDoor("error");
            setDoorMessage("Could not start a session");
        } finally {
            setNamePending(false);
        }
    }

    async function allowMic() {
        const on = await voice.allowMicrophone();
        send({ type: "set_muted", muted: !on });
        if (!on) {
            setToast("Microphone stayed off. You can try the mic button.");
        }
    }

    async function listenOnly() {
        const heard = await voice.unlockPlayback();
        if (!heard) {
            setToast("Still silent. Allow the microphone so the table can play.");
        }
    }

    async function toggleMic() {
        const next = !voice.micOn;
        await voice.setMicrophone(next);
        send({ type: "set_muted", muted: !next });
    }

    function copy(label: string, value: string) {
        void navigator.clipboard.writeText(value);
        setToast(`${label} copied`);
    }

    function requestReplay() {
        awaitingReplayRef.current = true;
        send({ type: "get_replay" });
    }

    async function saveImage() {
        try {
            await boardRef.current?.savePng(`board-house-${slugRef.current}.png`);
            setToast("Image saved");
        } catch {
            setToast("Could not save the image");
        }
    }

    function saveBoard() {
        try {
            boardRef.current?.saveExcalidraw(`board-house-${slugRef.current}.excalidraw`);
            setToast("Board saved");
        } catch {
            setToast("Could not save the board");
        }
    }

    if (!ready) {
        const connecting = doorCopy("connecting");
        return <DoorScreen title={connecting.title} body={connecting.body} />;
    }

    if (door === "need-name") {
        return (
            <DoorScreen title="Who is at the door?" body="A name is enough. There is no account.">
                <NameGate
                    title="Display name"
                    submitLabel="Sit down"
                    pending={namePending}
                    onSubmit={handleName}
                />
            </DoorScreen>
        );
    }

    if (door !== "joined" || !session) {
        const copyForDoor = doorCopy(door === "joined" ? "connecting" : door);
        return (
            <DoorScreen title={copyForDoor.title} body={doorMessage || copyForDoor.body}>
                {door === "denied" || door === "missing" || door === "expired" || door === "full" || door === "error" ? (
                    <a className="btn btn-brass" href="/">
                        Back to the house
                    </a>
                ) : null}
            </DoorScreen>
        );
    }

    return (
        <>
            <TableShell
                me={{ id: session.participantId, name: session.name }}
                hostKey={hostKey}
                door={door}
                doorMessage={doorMessage}
                table={table}
                canDraw={canDraw}
                snapshot={snapshot}
                remoteScene={remoteScene}
                cursors={remoteCursors}
                asks={asks}
                pendingAsk={pendingAsk}
                askResult={askResult}
                reactions={reactions}
                now={now}
                voiceConfigured={voice.configured}
                voiceUnlockNeeded={voice.configured === true && voice.unlockNeeded}
                micOn={voice.micOn}
                speakingIds={voice.speakingIds}
                onScene={(payload) => send({ type: "canvas", payload })}
                onCursor={(x, y, tool, button) =>
                    send({ type: "cursor", x, y, tool, button })
                }
                onTake={(slot) => send({ type: "take_marker", slot })}
                onDrop={(slot) => send({ type: "drop_marker", slot })}
                onGive={(slot, toParticipantId) => send({ type: "give_marker", slot, toParticipantId })}
                onAsk={(slot) => send({ type: "ask_marker", slot })}
                onCancelAsk={() => {
                    send({ type: "cancel_ask" });
                    setPendingAsk(null);
                }}
                onAnswer={(requestId, give) => {
                    send({ type: "answer_marker", requestId, give });
                    setAsks((current) => current.filter((item) => item.requestId !== requestId));
                }}
                onHostTake={(slot) => send({ type: "host_take_marker", slot })}
                onHostGive={(slot, toParticipantId) =>
                    send({ type: "host_give_marker", slot, toParticipantId })
                }
                onAdmit={(participantId) => send({ type: "admit", participantId })}
                onDeny={(participantId) => send({ type: "deny", participantId })}
                onMode={(accessMode) => send({ type: "set_mode", accessMode })}
                onRotate={() => send({ type: "rotate_slug" })}
                onEnd={() => send({ type: "end_room" })}
                onMute={(participantId) => send({ type: "mute_participant", participantId })}
                onMic={() => void toggleMic()}
                onAllowMic={() => void allowMic()}
                onListenOnly={() => void listenOnly()}
                onReact={(emoji) => send({ type: "react", emoji })}
                onReplay={requestReplay}
                onSaveImage={() => void saveImage()}
                onSaveBoard={saveBoard}
                onCopy={copy}
                onCloseRecap={() => setRecapEvents(null)}
                boardRef={boardRef}
                recapEvents={recapEvents}
            />
            {toast ? (
                <p className="toast" role="status">
                    {toast}
                </p>
            ) : null}
        </>
    );
}
