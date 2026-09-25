"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KNOCK_COOLDOWN_MS } from "@repo/common/constants";
import { useLocalSession } from "../hooks/useLocalSession";
import { useSocket } from "../hooks/useSocket";
import { useTableSocket, type DoorKind } from "../hooks/useTableSocket";
import { useVoice } from "../hooks/useVoice";
import { createSession, fetchRoom, isUnauthorizedError, refreshSession } from "../lib/api";
import { rememberHostKey, readHostKey, clearSession } from "../lib/session";
import { installAudioPrime, primeAudio } from "../lib/sounds";
import { elapsedLabel, nudgeTableLine, SLOW_MS, WAKE_BUDGET_MS } from "../lib/wake";
import type { BoardHandle, RemoteCursor } from "./BoardCanvas";
import { DoorScreen } from "./DoorScreen";
import { NameGate } from "./NameGate";
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
    const [waitStarted, setWaitStarted] = useState(0);
    const [knockReadyAt, setKnockReadyAt] = useState(0);
    const [knockNote, setKnockNote] = useState("");
    const [namePending, setNamePending] = useState(false);
    const [recapEvents, setRecapEvents] = useState<RecapEvent[] | null>(null);
    const boardRef = useRef<BoardHandle | null>(null);
    const awaitingReplayRef = useRef(false);
    const hostKey = hostKeyFromUrl || (ready ? readHostKey(slug) : null);
    const [joinToken, setJoinToken] = useState<string | null>(null);
    const preparedTokenRef = useRef<string | null>(null);
    const { socket, loading, failed, waking: lineWaking } = useSocket(joinToken);
    const [roomWaking, setRoomWaking] = useState(false);
    const [wakeSince, setWakeSince] = useState(0);
    const joined = door === "joined";
    const reconnecting = joined && !failed && (loading || !socket);
    const voice = useVoice({
        enabled: joined,
        token: joinToken,
        slug: table?.slug ?? slug,
    });
    const voiceRef = useRef(voice);
    voiceRef.current = voice;
    const slugRef = useRef(table?.slug ?? slug);
    slugRef.current = table?.slug ?? slug;
    const { send } = useTableSocket({
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
    });

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
        installAudioPrime();
        nudgeTableLine();
    }, []);

    useEffect(() => {
        if (!hostKeyFromUrl) {
            return;
        }
        rememberHostKey(slug, hostKeyFromUrl);
        router.replace(knockFromHouse ? `/room/${slug}?knock=1` : `/room/${slug}`);
    }, [hostKeyFromUrl, knockFromHouse, slug, router]);

    useEffect(() => {
        if (door !== "waiting") {
            setWaitStarted(0);
            setKnockReadyAt(0);
            setKnockNote("");
            return;
        }
        setWaitStarted((current) => current || Date.now());
        setKnockReadyAt((current) => current || Date.now() + KNOCK_COOLDOWN_MS);
    }, [door]);

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (failed) {
            setDoor("error");
            setDoorMessage("The table line didn't answer for a few minutes. Try again in a moment.");
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

    const [connectingSince, setConnectingSince] = useState(0);
    const [lookingSince, setLookingSince] = useState(0);
    const [namingSince, setNamingSince] = useState(0);
    const slow = (since: number) => since > 0 && now - since > SLOW_MS;
    const asleep =
        lineWaking ||
        roomWaking ||
        (door === "connecting" && slow(connectingSince)) ||
        slow(lookingSince) ||
        slow(namingSince);

    useEffect(() => {
        setConnectingSince((current) => (door === "connecting" ? current || Date.now() : 0));
    }, [door]);

    useEffect(() => {
        setWakeSince((current) =>
            asleep ? current || Math.min(...[connectingSince, lookingSince, namingSince].filter(Boolean), Date.now()) : 0
        );
    }, [asleep, connectingSince, lookingSince, namingSince]);

    useEffect(() => {
        let cancelled = false;
        let retryTimer: number | undefined;
        const started = Date.now();
        async function look() {
            setLookingSince((current) => current || Date.now());
            const result = await fetchRoom(slug);
            if (cancelled) {
                return;
            }
            setLookingSince(0);
            if (result.ok) {
                setRoomWaking(false);
                return;
            }
            if (result.status === "error" && Date.now() - started < WAKE_BUDGET_MS) {
                setRoomWaking(true);
                retryTimer = window.setTimeout(() => void look(), 3_000);
                return;
            }
            setRoomWaking(false);
            setDoor((current) =>
                current === "joined" || current === "waiting"
                    ? current
                    : result.status === "error"
                      ? "error"
                      : result.status
            );
        }
        void look();
        return () => {
            cancelled = true;
            window.clearTimeout(retryTimer);
        };
    }, [slug]);

    useEffect(() => {
        if (!toast) {
            return;
        }
        const timer = window.setTimeout(() => setToast(null), 2400);
        return () => window.clearTimeout(timer);
    }, [toast]);

    async function handleName(name: string) {
        primeAudio();
        setNamePending(true);
        setNamingSince(Date.now());
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
            setNamingSince(0);
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

    async function copy(label: string, value: string) {
        try {
            await navigator.clipboard.writeText(value);
            setToast(`${label} copied`);
        } catch {
            setToast("Could not copy");
        }
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
                {wakeSince ? (
                    <p className="door-kicker" role="status">
                        The house is waking up. It naps when nobody&apos;s around, so this can take a
                        minute or two. Waiting {elapsedLabel(now - wakeSince)}.
                    </p>
                ) : null}
            </DoorScreen>
        );
    }

    if (door === "waiting" && session) {
        const cool = Math.max(0, knockReadyAt - now);
        const inside = table ? table.usedSeats : null;
        const copyForDoor = doorCopy("waiting");
        return (
            <>
                <DoorScreen title={copyForDoor.title} body={doorMessage || copyForDoor.body}>
                    <p className="door-kicker">
                        {inside === null
                            ? "Checking who is inside."
                            : inside === 1
                              ? "1 person is inside."
                              : `${inside} people are inside.`}
                    </p>
                    <p className="door-kicker">
                        Waiting {waitStarted ? elapsedLabel(now - waitStarted) : "0s"}.
                    </p>
                    {knockNote ? <p className="door-kicker">{knockNote}</p> : null}
                    <div className="door-actions">
                        <button
                            className="btn btn-brass"
                            disabled={cool > 0}
                            onClick={() => {
                                primeAudio();
                                send({ type: "knock" });
                                setKnockReadyAt(Date.now() + KNOCK_COOLDOWN_MS);
                                setKnockNote("Knocked again.");
                            }}
                            type="button"
                        >
                            {cool > 0 ? `Knock again in ${Math.ceil(cool / 1000)}s` : "Knock again"}
                        </button>
                        <Link className="btn btn-ghost" href="/">
                            Back to the house
                        </Link>
                    </div>
                </DoorScreen>
                {toast ? (
                    <p className="toast" role="status">
                        {toast}
                    </p>
                ) : null}
            </>
        );
    }

    if ((door === "connecting" || door === "joined") && !joined && wakeSince) {
        return (
            <DoorScreen
                title="The house is waking up"
                body="It naps when nobody's around. Getting up can take a minute or two."
            >
                <p className="door-kicker">Waiting {elapsedLabel(now - wakeSince)}.</p>
            </DoorScreen>
        );
    }

    if (door !== "joined" || !session) {
        const copyForDoor = doorCopy(door === "joined" ? "connecting" : door);
        return (
            <DoorScreen title={copyForDoor.title} body={doorMessage || copyForDoor.body}>
                {door === "error" ? (
                    <div className="door-actions">
                        <button className="btn btn-brass" onClick={() => window.location.reload()} type="button">
                            Try again
                        </button>
                        <Link className="btn btn-ghost" href="/">
                            Back to the house
                        </Link>
                    </div>
                ) : door === "denied" || door === "missing" || door === "expired" || door === "full" ? (
                    <Link className="btn btn-brass" href="/">
                        Back to the house
                    </Link>
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
                reconnecting={reconnecting}
                onScene={(payload) => send({ type: "canvas", payload })}
                onCursor={(x, y, tool, button) => send({ type: "cursor", x, y, tool, button })}
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
                onCopy={(label, value) => void copy(label, value)}
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
