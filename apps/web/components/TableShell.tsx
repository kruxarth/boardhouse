"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { PresencePerson } from "@repo/common/types";
import { ASK_WINDOW_MS, REACTIONS } from "@repo/common/constants";
import { BoardCanvas, MARKER_INK, type BoardHandle, type RemoteCursor } from "./BoardCanvas";
import { InviteCard } from "./InviteCard";
import { installAudioPrime, playMarkerChime } from "../lib/sounds";
import { Avatar } from "./Avatars";
import {
    AskIcon,
    CloseIcon,
    DownloadIcon,
    DrawerIcon,
    FileIcon,
    GrabIcon,
    InkStroke,
    KeyIcon,
    LinkIcon,
    MicIcon,
    MicOffIcon,
    PlayIcon,
    PutDownIcon,
    RotateIcon,
    SmileIcon,
    WipeIcon,
} from "./Icons";
import { SittingRecap, type RecapEvent } from "./SittingRecap";

type DoorKind = "connecting" | "waiting" | "denied" | "full" | "expired" | "missing" | "error";

export type MarkerAsk = {
    requestId: string;
    fromParticipantId: string;
    fromName: string;
    fromAvatar: number;
    slot: 0 | 1;
    expiresAt: string;
};

export type PendingAsk = {
    requestId: string;
    slot: 0 | 1;
    holderId: string;
    holderName: string;
    expiresAt: string;
};

export type AskResult = { slot: 0 | 1; outcome: "given" | "kept" | "lapsed"; n: number };

export type LiveReaction = { id: string; participantId: string; emoji: string };

export type TableModel = {
    slug: string;
    name: string | null;
    accessMode: "knock" | "open";
    expiresAt: string;
    hostParticipantId: string;
    seats: PresencePerson[];
    waiters: PresencePerson[];
    markers: [string | null, string | null];
    viaFormerSlug: boolean;
    usedSeats: number;
    maxSeats: number;
};

const MARKER_NAMES = ["Pink marker", "Black marker"] as const;
const RESULT_NOTE = {
    kept: "kept it",
    lapsed: "no answer",
    given: "yours",
} as const;

function remainingLabel(expiresAt: string, now: number) {
    const ms = new Date(expiresAt).getTime() - now;
    if (ms <= 0) {
        return "wiped";
    }
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    if (hours > 0) {
        return `${hours}h ${minutes}m left`;
    }
    const seconds = Math.floor((ms % 60_000) / 1000);
    if (minutes > 0) {
        return `${minutes}m ${seconds}s left`;
    }
    return `${seconds}s left`;
}

/** The pen fuses run on a 9s window, so the once-a-second room clock is too coarse. */
function useFuse(active: boolean) {
    const [tick, setTick] = useState(() => Date.now());
    useEffect(() => {
        if (!active) {
            return;
        }
        const timer = window.setInterval(() => setTick(Date.now()), 120);
        return () => window.clearInterval(timer);
    }, [active]);
    return active ? tick : 0;
}

function fuseLeft(expiresAt: string, tick: number) {
    const ms = new Date(expiresAt).getTime() - (tick || Date.now());
    return Math.max(0, Math.min(1, ms / ASK_WINDOW_MS));
}

function fuseLate(expiresAt: string, tick: number) {
    const ms = new Date(expiresAt).getTime() - (tick || Date.now());
    return ms > 0 && ms <= 3_000;
}

const HOUR_MS = 60 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;

function watchCopy(table: TableModel, byId: Map<string, PresencePerson>) {
    const pinkId = table.markers[0];
    const blackId = table.markers[1];
    const pink = pinkId ? (byId.get(pinkId) ?? null) : null;
    const blackFree = !blackId;
    const pinkFree = !pinkId;
    if (pinkFree && blackFree) {
        return { text: "Watching · a marker is free", action: "Pick it up", slot: 0 as const, kind: "take" as const };
    }
    if (pinkFree) {
        return { text: "Watching · the pink marker is free", action: "Pick it up", slot: 0 as const, kind: "take" as const };
    }
    if (blackFree) {
        return { text: "Watching · the black marker is free", action: "Pick it up", slot: 1 as const, kind: "take" as const };
    }
    if (pinkId && !pink) {
        return {
            text: "Watching · the pink marker is reconnecting",
            action: null,
            slot: 0 as const,
            kind: "wait" as const,
        };
    }
    const name = pink?.name ?? "them";
    return {
        text: `Watching · ask ${name} for the pink marker`,
        action: `Ask ${name}`,
        slot: 0 as const,
        kind: "ask" as const,
    };
}

export function TableShell({
    me,
    hostKey,
    door,
    table,
    canDraw,
    snapshot,
    remoteScene,
    cursors,
    asks,
    pendingAsk,
    askResult,
    reactions,
    now,
    voiceConfigured,
    voiceUnlockNeeded,
    micOn,
    speakingIds,
    reconnecting,
    onScene,
    onCursor,
    onTake,
    onDrop,
    onGive,
    onAsk,
    onCancelAsk,
    onAnswer,
    onHostTake,
    onHostGive,
    onAdmit,
    onDeny,
    onMode,
    onRotate,
    onEnd,
    onMute,
    onMic,
    onAllowMic,
    onListenOnly,
    onReact,
    onReplay,
    onSaveImage,
    onSaveBoard,
    onCopy,
    onCloseRecap,
    boardRef,
    recapEvents,
}: {
    me: { id: string; name: string };
    hostKey: string | null;
    door: DoorKind | "joined" | "need-name";
    doorMessage: string;
    table: TableModel | null;
    canDraw: boolean;
    snapshot: unknown;
    remoteScene: unknown;
    cursors: RemoteCursor[];
    asks: MarkerAsk[];
    pendingAsk: PendingAsk | null;
    askResult: AskResult | null;
    reactions: LiveReaction[];
    now: number;
    voiceConfigured: boolean | null;
    voiceUnlockNeeded: boolean;
    micOn: boolean;
    speakingIds: string[];
    reconnecting: boolean;
    onScene: (payload: unknown) => void;
    onCursor: (x: number, y: number, tool: "pointer" | "laser", button: "up" | "down") => void;
    onTake: (slot: 0 | 1) => void;
    onDrop: (slot: 0 | 1) => void;
    onGive: (slot: 0 | 1, toParticipantId: string) => void;
    onAsk: (slot: 0 | 1) => void;
    onCancelAsk: () => void;
    onAnswer: (requestId: string, give: boolean) => void;
    onHostTake: (slot: 0 | 1) => void;
    onHostGive: (slot: 0 | 1, toParticipantId: string) => void;
    onAdmit: (participantId: string) => void;
    onDeny: (participantId: string) => void;
    onMode: (mode: "knock" | "open") => void;
    onRotate: () => void;
    onEnd: () => void;
    onMute: (participantId: string) => void;
    onMic: () => void;
    onAllowMic: () => void;
    onListenOnly: () => void;
    onReact: (emoji: string) => void;
    onReplay: () => void;
    onSaveImage: () => void;
    onSaveBoard: () => void;
    onCopy: (label: string, value: string) => void;
    onCloseRecap: () => void;
    boardRef: RefObject<BoardHandle | null>;
    recapEvents: RecapEvent[] | null;
}) {
    const [confirmEnd, setConfirmEnd] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [inviteClosed, setInviteClosed] = useState(() => readInviteClosed(table?.slug));
    const [note, setNote] = useState<{ slot: 0 | 1; text: string } | null>(null);
    const isHost = Boolean(table && table.hostParticipantId === me.id);
    const guestUrl = table ? `${typeof window !== "undefined" ? window.location.origin : ""}/room/${table.slug}` : "";
    const hostUrl = table && hostKey ? `${guestUrl}?host=${hostKey}` : "";

    useEffect(() => {
        if (!askResult) {
            return;
        }
        setNote({ slot: askResult.slot, text: RESULT_NOTE[askResult.outcome] });
        const timer = window.setTimeout(() => setNote(null), 2600);
        return () => window.clearTimeout(timer);
    }, [askResult]);

    const seats = useMemo(() => table?.seats ?? [], [table]);
    // Your own row stays first so the mic toggle never moves as people come and go.
    const ordered = useMemo(() => {
        const mine = seats.filter((seat) => seat.id === me.id);
        const rest = seats.filter((seat) => seat.id !== me.id);
        return [...mine, ...rest];
    }, [seats, me.id]);

    const byId = useMemo(() => {
        const map = new Map<string, PresencePerson>();
        for (const seat of seats) {
            map.set(seat.id, seat);
        }
        return map;
    }, [seats]);

    const [menuTick, setMenuTick] = useState<[number, number]>([0, 0]);
    const [receivedSlot, setReceivedSlot] = useState<0 | 1 | null>(null);
    const [selfDrawing, setSelfDrawing] = useState(false);
    const [hintDismissed, setHintDismissed] = useState(false);
    const [hintFlash, setHintFlash] = useState(0);
    const [expiryBanner, setExpiryBanner] = useState<null | "hour" | "ten">(null);
    const warnedHour = useRef(false);
    const warnedTen = useRef(false);
    const prevMarkers = useRef<string | null>(null);
    const markerKey = table ? `${table.markers[0] ?? ""}\n${table.markers[1] ?? ""}` : "";

    useEffect(() => {
        installAudioPrime();
    }, []);

    useEffect(() => {
        if (!canDraw) {
            return;
        }
        setHintDismissed(false);
        setHintFlash(0);
        setSelfDrawing(false);
    }, [canDraw]);

    useEffect(() => {
        if (hintFlash === 0) {
            return;
        }
        const timer = window.setTimeout(() => setHintFlash(0), 3_200);
        return () => window.clearTimeout(timer);
    }, [hintFlash]);

    useEffect(() => {
        const name = table?.name?.trim() || "Untitled sitting";
        const knocks = isHost ? (table?.waiters.length ?? 0) : 0;
        document.title = knocks > 0 ? `(${knocks}) knocking · ${name}` : `${name} · board-house`;
        return () => {
            document.title = "board-house";
        };
    }, [isHost, table?.name, table?.waiters.length]);

    useEffect(() => {
        if (!table) {
            return;
        }
        const left = new Date(table.expiresAt).getTime() - now;
        if (left <= 0) {
            return;
        }
        if (left <= TEN_MIN_MS) {
            if (!warnedTen.current) {
                warnedTen.current = true;
                setExpiryBanner("ten");
            }
            return;
        }
        if (left <= HOUR_MS && !warnedHour.current) {
            warnedHour.current = true;
            setExpiryBanner("hour");
        }
    }, [now, table]);

    const markersRef = useRef(table?.markers);
    markersRef.current = table?.markers;

    useEffect(() => {
        const previous = prevMarkers.current;
        prevMarkers.current = markerKey;
        const markers = markersRef.current;
        if (!markers || previous === null) {
            return;
        }
        const [wasPink, wasBlack] = previous.split("\n");
        const before: [string, string] = [wasPink ?? "", wasBlack ?? ""];
        const passed = ([0, 1] as const).find((slot) => {
            const nowId = markers[slot] ?? "";
            return nowId === me.id && before[slot] !== "" && before[slot] !== me.id;
        });
        if (passed === undefined) {
            return;
        }
        playMarkerChime();
        setReceivedSlot(passed);
        const timer = window.setTimeout(() => setReceivedSlot(null), 900);
        return () => window.clearTimeout(timer);
    }, [markerKey, me.id]);

    function openPen(slot: 0 | 1) {
        setMenuTick((current) => {
            const next: [number, number] = [current[0], current[1]];
            next[slot] += 1;
            return next;
        });
    }

    function nudgeWatchHint() {
        if (!hintDismissed) {
            return;
        }
        setHintFlash((count) => count + 1);
    }

    if (door !== "joined" || !table) {
        return null;
    }

    const watching = !canDraw ? watchCopy(table, byId) : null;
    const showWatchHint = Boolean(watching && (!hintDismissed || hintFlash > 0));
    const alone = isHost && seats.length <= 1 && !inviteClosed;
    const graceNames = ([0, 1] as const)
        .filter((slot) => {
            const id = table.markers[slot];
            return Boolean(id && !byId.has(id));
        })
        .map((slot) => (slot === 0 ? "Pink marker" : "Black marker"));
    const expiryCopy =
        expiryBanner === "ten"
            ? "10 minutes left on this table."
            : expiryBanner === "hour"
              ? "1 hour left on this table."
              : null;

    return (
        <div className={drawerOpen ? "table-shell drawer-open" : "table-shell"}>
            <header className="table-rail">
                <div className="rail-left">
                    <div className="rail-brand">
                        <p className="rail-name">{table.name || "Untitled sitting"}</p>
                        <p className="rail-meta">
                            {table.usedSeats} / {table.maxSeats} seats
                            <span className="fuse">{remainingLabel(table.expiresAt, now)}</span>
                            {reconnecting ? <span className="rail-reconnect">Reconnecting</span> : null}
                        </p>
                    </div>
                    <ul className="seats">
                        {ordered.map((seat) => {
                            const holdsMarker =
                                table.markers[0] === seat.id || table.markers[1] === seat.id;
                            const drawing =
                                holdsMarker &&
                                (seat.id === me.id
                                    ? selfDrawing
                                    : cursors.some(
                                          (cursor) =>
                                              cursor.id === seat.id &&
                                              cursor.button === "down" &&
                                              cursor.tool !== "laser"
                                      ));
                            return (
                            <SeatChip
                                key={seat.id}
                                seat={seat}
                                isMe={seat.id === me.id}
                                isTheHost={seat.id === table.hostParticipantId}
                                iAmHost={isHost}
                                speaking={speakingIds.includes(seat.id) && !seat.muted}
                                drawing={drawing}
                                micOn={micOn}
                                voiceConfigured={voiceConfigured}
                                reactions={reactions.filter((item) => item.participantId === seat.id)}
                                onMic={onMic}
                                onMute={onMute}
                            />
                            );
                        })}
                    </ul>
                </div>

                <div className="rail-right">
                    <div className="pens" aria-label="Markers">
                        {([0, 1] as const).map((slot) => {
                            const heldById = table.markers[slot];
                            return (
                            <Pen
                                key={slot}
                                slot={slot}
                                meId={me.id}
                                heldById={heldById}
                                holder={heldById ? (byId.get(heldById) ?? null) : null}
                                seats={seats}
                                isHost={isHost}
                                incoming={asks.filter((ask) => ask.slot === slot)}
                                pending={pendingAsk?.slot === slot ? pendingAsk : null}
                                note={note?.slot === slot ? note.text : null}
                                openTick={menuTick[slot]}
                                received={receivedSlot === slot}
                                onTake={onTake}
                                onDrop={onDrop}
                                onGive={onGive}
                                onAsk={onAsk}
                                onCancelAsk={onCancelAsk}
                                onAnswer={onAnswer}
                                onHostTake={onHostTake}
                                onHostGive={onHostGive}
                            />
                            );
                        })}
                    </div>

                    <ReactionBar onReact={onReact} />

                    <button
                        aria-controls="table-drawer"
                        aria-expanded={drawerOpen}
                        aria-label={drawerOpen ? "Close table tools" : "Open table tools"}
                        className="icon-btn"
                        onClick={() => setDrawerOpen((open) => !open)}
                        title={drawerOpen ? "Close tools" : "Table tools"}
                        type="button"
                    >
                        {drawerOpen ? <CloseIcon /> : <DrawerIcon />}
                    </button>
                </div>
            </header>

            <div className="board-wrap">
                {voiceUnlockNeeded ? (
                    <div className="hear-banner" role="dialog" aria-labelledby="hear-title" aria-describedby="hear-copy">
                        <div>
                            <p id="hear-title">The table is talking.</p>
                            <p id="hear-copy">
                                Allow the microphone so you can hear. Stay muted after, if you want.
                            </p>
                        </div>
                        <button className="btn btn-brass" onClick={onAllowMic} type="button">
                            Allow microphone
                        </button>
                        <button className="btn btn-ghost" onClick={onListenOnly} type="button">
                            Just listen
                        </button>
                    </div>
                ) : null}
                {isHost && table.waiters.length > 0 ? (
                    <div className="table-queues">
                        <aside className="knock-list">
                            <p>At the door</p>
                            <ul>
                                {table.waiters.map((waiter) => (
                                    <li key={waiter.id}>
                                        <span className="knock-who">
                                            <Avatar id={waiter.id} index={waiter.avatar} />
                                            {waiter.name}
                                        </span>
                                        <button className="btn btn-brass" onClick={() => onAdmit(waiter.id)} type="button">
                                            Admit
                                        </button>
                                        <button className="btn btn-ghost" onClick={() => onDeny(waiter.id)} type="button">
                                            Deny
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </aside>
                    </div>
                ) : null}
                {expiryCopy ? (
                    <div className="expiry-banner" role="status">
                        <p>
                            {expiryCopy} Save the board if you want to keep it.
                        </p>
                        <button className="btn btn-brass" onClick={onSaveBoard} type="button">
                            Save board
                        </button>
                        <button className="btn btn-ghost" onClick={() => setExpiryBanner(null)} type="button">
                            Dismiss
                        </button>
                    </div>
                ) : null}
                <BoardCanvas
                    ref={boardRef}
                    canDraw={canDraw}
                    allowLaser
                    markerSlot={
                        table.markers[0] === me.id ? 0 : table.markers[1] === me.id ? 1 : null
                    }
                    snapshot={snapshot}
                    remoteScene={remoteScene}
                    cursors={cursors}
                    onDeniedDraw={nudgeWatchHint}
                    onDrawing={(drawing) => {
                        setSelfDrawing((current) => (current === drawing ? current : drawing));
                    }}
                    onScene={onScene}
                    onCursor={onCursor}
                />
                {alone ? (
                    <InviteCard
                        onClose={() => {
                            setInviteClosed(true);
                            rememberInviteClosed(table.slug);
                        }}
                        onCopy={() => onCopy("Invite link", guestUrl)}
                    />
                ) : null}
                {showWatchHint && watching ? (
                    <div className="watch-hint" role="status">
                        <p>{watching.text}</p>
                        {watching.action ? (
                            <button
                                className="btn btn-brass btn-tiny"
                                onClick={() => {
                                    if (watching.kind === "take") {
                                        onTake(watching.slot);
                                        return;
                                    }
                                    openPen(watching.slot);
                                }}
                                type="button"
                            >
                                {watching.action}
                            </button>
                        ) : null}
                        <button
                            className="btn btn-ghost btn-tiny"
                            onClick={() => {
                                setHintDismissed(true);
                                setHintFlash(0);
                            }}
                            type="button"
                        >
                            Hide
                        </button>
                    </div>
                ) : null}
                {!reconnecting && graceNames.length > 0 ? (
                    <p className="grace-banner" role="status">
                        Reconnecting… {graceNames.join(" and ")} {graceNames.length === 1 ? "is" : "are"} still held.
                    </p>
                ) : null}
                {reconnecting ? (
                    <div className="reconnect-overlay" role="status">
                        Reconnecting…
                    </div>
                ) : null}
                {recapEvents ? (
                    <SittingRecap events={recapEvents} onClose={onCloseRecap} />
                ) : null}
            </div>

            <aside className="table-drawer" hidden={!drawerOpen} id="table-drawer">
                <p className="drawer-kicker">Table tools</p>
                <button className="drawer-item" onClick={onSaveImage} type="button">
                    <DownloadIcon />
                    Save image
                </button>
                <button className="drawer-item" onClick={onSaveBoard} type="button">
                    <FileIcon />
                    Save board
                </button>
                <button className="drawer-item" onClick={onReplay} type="button">
                    <PlayIcon />
                    Replay
                </button>
                <button className="drawer-item" onClick={() => onCopy("Invite link", guestUrl)} type="button">
                    <LinkIcon />
                    Copy invite link
                </button>
                {isHost && hostUrl ? (
                    <button className="drawer-item" onClick={() => onCopy("Host link", hostUrl)} type="button">
                        <KeyIcon />
                        Copy host link (keep private)
                    </button>
                ) : null}
                {isHost ? (
                    <>
                        <div className="mode-switch">
                            <p className="mode-switch-label" id="house-mode-label">
                                From the house
                            </p>
                            <div aria-labelledby="house-mode-label" className="mode-switch-options" role="radiogroup">
                                <button
                                    aria-checked={table.accessMode === "open"}
                                    className="mode-option"
                                    onClick={() => onMode("open")}
                                    role="radio"
                                    type="button"
                                >
                                    Walk in
                                </button>
                                <button
                                    aria-checked={table.accessMode === "knock"}
                                    className="mode-option"
                                    onClick={() => onMode("knock")}
                                    role="radio"
                                    type="button"
                                >
                                    Knock first
                                </button>
                            </div>
                            <p className="mode-help">
                                {table.accessMode === "open"
                                    ? "People from the house can sit down."
                                    : "People from the house wait at the door."}
                            </p>
                        </div>
                        <button
                            className="drawer-item"
                            onClick={onRotate}
                            title="Issues a new guest URL. Anyone with the old link has to knock."
                            type="button"
                        >
                            <RotateIcon />
                            New guest URL
                        </button>
                        {confirmEnd ? (
                            <div className="end-confirm">
                                <p>Wipe this table now? Everyone is kicked and the board is gone.</p>
                                <button
                                    className="btn btn-ghost btn-tiny"
                                    onClick={() => setConfirmEnd(false)}
                                    type="button"
                                >
                                    Keep sitting
                                </button>
                                <button className="btn btn-brass btn-tiny" onClick={onEnd} type="button">
                                    Wipe table
                                </button>
                            </div>
                        ) : (
                            <button
                                className="drawer-item drawer-item-danger"
                                onClick={() => setConfirmEnd(true)}
                                type="button"
                            >
                                <WipeIcon />
                                End sitting
                            </button>
                        )}
                    </>
                ) : null}
            </aside>

            {table.viaFormerSlug && !isHost ? (
                <p className="note">This link was rotated. The host has to let you in.</p>
            ) : null}
        </div>
    );
}

function SeatChip({
    seat,
    isMe,
    isTheHost,
    iAmHost,
    speaking,
    drawing,
    micOn,
    voiceConfigured,
    reactions,
    onMic,
    onMute,
}: {
    seat: PresencePerson;
    isMe: boolean;
    isTheHost: boolean;
    iAmHost: boolean;
    speaking: boolean;
    drawing: boolean;
    micOn: boolean;
    voiceConfigured: boolean | null;
    reactions: LiveReaction[];
    onMic: () => void;
    onMute: (participantId: string) => void;
}) {
    const live = isMe ? micOn : !seat.muted;
    const micClass = `seat-mic${live ? " mic-on" : " mic-off"}${speaking ? " seat-mic-speaking" : ""}`;

    return (
        <li className={isMe ? "seat seat-me" : "seat"}>
            <span className="seat-face">
                <Avatar id={seat.id} index={seat.avatar} />
            </span>
            <span className="seat-name">
                {seat.name}
                {isTheHost ? <em className="seat-host">host</em> : null}
                {drawing ? <em className="seat-drawing">drawing</em> : null}
            </span>
            {isMe ? (
                <button
                    aria-label={micOn ? "Mute yourself" : "Unmute yourself"}
                    aria-pressed={micOn}
                    className={`${micClass} seat-mic-btn`}
                    disabled={voiceConfigured === false}
                    onClick={onMic}
                    title={
                        voiceConfigured === false
                            ? "Voice not configured"
                            : micOn
                              ? "Mic on"
                              : "Mic off"
                    }
                    type="button"
                >
                    {micOn ? <MicIcon /> : <MicOffIcon />}
                </button>
            ) : iAmHost && !seat.muted ? (
                <button
                    aria-label={`Mute ${seat.name}`}
                    className={`${micClass} seat-mic-btn`}
                    onClick={() => onMute(seat.id)}
                    title={`Mute ${seat.name}`}
                    type="button"
                >
                    <MicIcon />
                </button>
            ) : (
                <span className={micClass}>
                    <span aria-hidden="true">{seat.muted ? <MicOffIcon /> : <MicIcon />}</span>
                    {speaking ? <span className="sr-only">speaking</span> : null}
                </span>
            )}
            <span aria-hidden="true" className="seat-floats">
                {reactions.map((item) => (
                    <span className="float-emoji" key={item.id}>
                        {item.emoji}
                    </span>
                ))}
            </span>
        </li>
    );
}

function ReactionBar({ onReact }: { onReact: (emoji: string) => void }) {
    const [open, setOpen] = useState(false);
    const wrap = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        function onDown(event: PointerEvent) {
            if (!wrap.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        }
        function onKey(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setOpen(false);
            }
        }
        document.addEventListener("pointerdown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    return (
        <div className="react-bar" ref={wrap}>
            <button
                aria-expanded={open}
                aria-label="React"
                className={open ? "icon-btn icon-btn-on" : "icon-btn"}
                onClick={() => setOpen((value) => !value)}
                title="React"
                type="button"
            >
                <SmileIcon />
            </button>
            {open ? (
                <div className="react-tray" role="menu">
                    {REACTIONS.map((emoji) => (
                        <button
                            aria-label={`React ${emoji}`}
                            className="react-key"
                            key={emoji}
                            onClick={() => {
                                onReact(emoji);
                                setOpen(false);
                            }}
                            role="menuitem"
                            type="button"
                        >
                            {emoji}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function Pen({
    slot,
    meId,
    heldById,
    holder,
    seats,
    isHost,
    incoming,
    pending,
    note,
    openTick,
    received,
    onTake,
    onDrop,
    onGive,
    onAsk,
    onCancelAsk,
    onAnswer,
    onHostTake,
    onHostGive,
}: {
    slot: 0 | 1;
    meId: string;
    heldById: string | null;
    holder: PresencePerson | null;
    seats: PresencePerson[];
    isHost: boolean;
    incoming: MarkerAsk[];
    pending: PendingAsk | null;
    note: string | null;
    openTick: number;
    received: boolean;
    onTake: (slot: 0 | 1) => void;
    onDrop: (slot: 0 | 1) => void;
    onGive: (slot: 0 | 1, toParticipantId: string) => void;
    onAsk: (slot: 0 | 1) => void;
    onCancelAsk: () => void;
    onAnswer: (requestId: string, give: boolean) => void;
    onHostTake: (slot: 0 | 1) => void;
    onHostGive: (slot: 0 | 1, toParticipantId: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const wrap = useRef<HTMLDivElement | null>(null);
    const openTimer = useRef<number | undefined>(undefined);
    const closeTimer = useRef<number | undefined>(undefined);
    const touched = useRef(false);

    const reconnectingHold = Boolean(heldById) && holder === null;
    const mine = holder?.id === meId;
    const free = !heldById;
    const label = MARKER_NAMES[slot];
    const others = seats.filter((seat) => seat.id !== meId);
    const hostGiveTo = isHost && !mine ? others.filter((seat) => seat.id !== holder?.id) : [];
    const showHost = isHost && !mine && (!free || hostGiveTo.length > 0);
    const asked = incoming.length > 0;
    const tick = useFuse(asked || Boolean(pending));

    const clearTimers = useCallback(() => {
        window.clearTimeout(openTimer.current);
        window.clearTimeout(closeTimer.current);
    }, []);

    const close = useCallback(() => {
        clearTimers();
        setOpen(false);
    }, [clearTimers]);

    useEffect(() => () => clearTimers(), [clearTimers]);

    useEffect(() => {
        if (openTick > 0) {
            setOpen(true);
        }
    }, [openTick]);

    useEffect(() => {
        if (asked) {
            setOpen(false);
        }
    }, [asked]);

    useEffect(() => {
        if (!open) {
            return;
        }
        function onDown(event: PointerEvent) {
            if (!wrap.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        }
        function onKey(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setOpen(false);
            }
        }
        document.addEventListener("pointerdown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    function act(run: () => void) {
        run();
        close();
    }

    const status = free
        ? "free"
        : reconnectingHold
          ? "reconnecting"
          : mine
            ? "yours"
            : pending
              ? `asking ${holder?.name ?? "someone"}`
              : (holder?.name ?? "someone");
    const pendingLate = pending ? fuseLate(pending.expiresAt, tick) : false;

    return (
        <div
            className={`pen${mine ? " pen-mine" : ""}${free ? " pen-free" : ""}${reconnectingHold ? " pen-away" : ""}${asked ? " pen-asked" : ""}${received ? " pen-received" : ""}`}
            onPointerEnter={(event) => {
                if (event.pointerType !== "mouse" || asked) {
                    return;
                }
                clearTimers();
                openTimer.current = window.setTimeout(() => setOpen(true), 150);
            }}
            onPointerLeave={(event) => {
                if (event.pointerType !== "mouse") {
                    return;
                }
                clearTimers();
                closeTimer.current = window.setTimeout(() => setOpen(false), 220);
            }}
            ref={wrap}
        >
            <button
                aria-expanded={open}
                aria-haspopup="menu"
                aria-label={`${label}, ${status}`}
                className="pen-chip"
                onClick={() => {
                    setOpen((value) => (touched.current ? !value : true));
                }}
                onPointerDown={(event) => {
                    touched.current = event.pointerType !== "mouse";
                }}
                type="button"
            >
                <span className="pen-ink">
                    <InkStroke ink={MARKER_INK[slot]} />
                </span>
                <span className="pen-holder">
                    {holder ? (
                        <Avatar id={holder.id} index={holder.avatar} />
                    ) : reconnectingHold ? (
                        <span className="pen-away-mark">…</span>
                    ) : (
                        <span className="pen-empty" />
                    )}
                </span>
                {pending ? (
                    <span
                        className={pendingLate ? "pen-fuse pen-fuse-late" : "pen-fuse"}
                        style={{ ["--left" as string]: fuseLeft(pending.expiresAt, tick) }}
                    />
                ) : null}
            </button>

            {note ? <span className="pen-note">{note}</span> : null}

            {asked ? (
                <div className="pen-asks">
                    {incoming.map((ask) => (
                        <div
                            aria-label={`${ask.fromName} wants the ${label}`}
                            className="pen-ask"
                            key={ask.requestId}
                            role="alertdialog"
                        >
                            <span className="pen-ask-who">
                                <Avatar id={ask.fromParticipantId} index={ask.fromAvatar} />
                                {ask.fromName}
                            </span>
                            <button
                                className="btn btn-brass btn-tiny"
                                onClick={() => onAnswer(ask.requestId, true)}
                                type="button"
                            >
                                Pass
                            </button>
                            <button
                                className="btn btn-ghost btn-tiny"
                                onClick={() => onAnswer(ask.requestId, false)}
                                type="button"
                            >
                                Keep
                            </button>
                            <span
                                className={
                                    fuseLate(ask.expiresAt, tick)
                                        ? "pen-ask-fuse pen-fuse-late"
                                        : "pen-ask-fuse"
                                }
                                style={{ ["--left" as string]: fuseLeft(ask.expiresAt, tick) }}
                            />
                        </div>
                    ))}
                </div>
            ) : null}

            {open ? (
                <div className="pen-menu" role="menu">
                    <p className="pen-menu-head">{label}</p>
                    {reconnectingHold ? <p className="pen-menu-kicker">Reconnecting…</p> : null}

                    {free ? (
                        <button className="pen-item" onClick={() => act(() => onTake(slot))} role="menuitem" type="button">
                            <GrabIcon />
                            Pick it up
                        </button>
                    ) : null}

                    {mine ? (
                        <button className="pen-item" onClick={() => act(() => onDrop(slot))} role="menuitem" type="button">
                            <PutDownIcon />
                            Put it down
                        </button>
                    ) : null}

                    {mine && others.length > 0 ? (
                        <>
                            <p className="pen-menu-kicker">Pass to</p>
                            {others.map((seat) => (
                                <button
                                    className="pen-item"
                                    key={seat.id}
                                    onClick={() => act(() => onGive(slot, seat.id))}
                                    role="menuitem"
                                    type="button"
                                >
                                    <Avatar id={seat.id} index={seat.avatar} />
                                    {seat.name}
                                </button>
                            ))}
                        </>
                    ) : null}

                    {!free && !mine && (pending || !reconnectingHold) ? (
                        pending ? (
                            <button className="pen-item" onClick={() => act(onCancelAsk)} role="menuitem" type="button">
                                <CloseIcon />
                                Cancel the ask
                            </button>
                        ) : (
                            <button
                                className="pen-item"
                                onClick={() => act(() => onAsk(slot))}
                                role="menuitem"
                                type="button"
                            >
                                <AskIcon />
                                Ask {holder?.name ?? "them"}
                            </button>
                        )
                    ) : null}

                    {showHost ? (
                        <>
                            <p className="pen-menu-kicker">Host</p>
                            {!free ? (
                                <button
                                    className="pen-item pen-item-host"
                                    onClick={() => act(() => onHostTake(slot))}
                                    role="menuitem"
                                    type="button"
                                >
                                    <GrabIcon />
                                    Take it
                                </button>
                            ) : null}
                            {hostGiveTo.map((seat) => (
                                <button
                                    className="pen-item pen-item-host"
                                    key={seat.id}
                                    onClick={() => act(() => onHostGive(slot, seat.id))}
                                    role="menuitem"
                                    type="button"
                                >
                                    <Avatar id={seat.id} index={seat.avatar} />
                                    Hand to {seat.name}
                                </button>
                            ))}
                        </>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

const INVITE_CLOSED_KEY = "board-house.invite-closed.";

function readInviteClosed(slug: string | undefined) {
    if (!slug) {
        return false;
    }
    try {
        return localStorage.getItem(INVITE_CLOSED_KEY + slug) === "1";
    } catch {
        return false;
    }
}

function rememberInviteClosed(slug: string) {
    try {
        localStorage.setItem(INVITE_CLOSED_KEY + slug, "1");
    } catch {
        // Closing still works for this visit.
    }
}

export function doorCopy(kind: DoorKind): { title: string; body: string } {
    switch (kind) {
        case "waiting":
            return {
                title: "Closed door",
                body: "You are at the door. The host can let you in.",
            };
        case "denied":
            return {
                title: "Door stayed shut",
                body: "The host kept this door closed.",
            };
        case "full":
            return {
                title: "The table is full",
                body: "Ten seats. There is not one left.",
            };
        case "expired":
            return {
                title: "This sitting is over",
                body: "The table was wiped.",
            };
        case "missing":
            return {
                title: "No table at this door",
                body: "This link does not open a sitting.",
            };
        case "connecting":
            return {
                title: "Pulling up a chair",
                body: "Connecting to the table.",
            };
        default:
            return {
                title: "Something jammed",
                body: "The table could not be opened. Try the link again.",
            };
    }
}
