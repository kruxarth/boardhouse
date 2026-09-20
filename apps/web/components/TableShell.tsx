"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import type { PresencePerson } from "@repo/common/types";
import { BoardCanvas, type BoardHandle, type RemoteCursor } from "./BoardCanvas";
import {
    CloseIcon,
    DoorIcon,
    DownloadIcon,
    DrawerIcon,
    FileIcon,
    KeyIcon,
    LinkIcon,
    MarkerOneIcon,
    MarkerTwoIcon,
    MicIcon,
    MicOffIcon,
    PlayIcon,
    RotateIcon,
    WipeIcon,
} from "./Icons";
import { SittingRecap, type RecapEvent } from "./SittingRecap";

type DoorKind = "connecting" | "waiting" | "denied" | "full" | "expired" | "missing" | "error";

export type MarkerAsk = {
    requestId: string;
    fromParticipantId: string;
    fromName: string;
    slot: 0 | 1;
};

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

function personName(seats: PresencePerson[], id: string | null) {
    if (!id) {
        return null;
    }
    return seats.find((seat) => seat.id === id)?.name ?? "someone";
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
    keptTick,
    now,
    voiceConfigured,
    voiceUnlockNeeded,
    micOn,
    speakingIds,
    onScene,
    onCursor,
    onTake,
    onDrop,
    onGive,
    onAsk,
    onAnswer,
    onHostTake,
    onAdmit,
    onDeny,
    onMode,
    onRotate,
    onEnd,
    onMute,
    onMic,
    onAllowMic,
    onListenOnly,
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
    keptTick: { slot: 0 | 1; n: number } | null;
    now: number;
    voiceConfigured: boolean | null;
    voiceUnlockNeeded: boolean;
    micOn: boolean;
    speakingIds: string[];
    onScene: (payload: unknown) => void;
    onCursor: (x: number, y: number, tool: "pointer" | "laser", button: "up" | "down") => void;
    onTake: (slot: 0 | 1) => void;
    onDrop: (slot: 0 | 1) => void;
    onGive: (slot: 0 | 1, toParticipantId: string) => void;
    onAsk: (holderId: string) => void;
    onAnswer: (requestId: string, give: boolean) => void;
    onHostTake: (slot: 0 | 1) => void;
    onAdmit: (participantId: string) => void;
    onDeny: (participantId: string) => void;
    onMode: (mode: "knock" | "open") => void;
    onRotate: () => void;
    onEnd: () => void;
    onMute: (participantId: string) => void;
    onMic: () => void;
    onAllowMic: () => void;
    onListenOnly: () => void;
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
    const [askedSlots, setAskedSlots] = useState<Partial<Record<0 | 1, true>>>({});
    const isHost = Boolean(table && table.hostParticipantId === me.id);
    const guestUrl = table ? `${typeof window !== "undefined" ? window.location.origin : ""}/room/${table.slug}` : "";
    const hostUrl =
        table && hostKey
            ? `${guestUrl}?host=${hostKey}`
            : "";

    const asked = useMemo(() => {
        const next: Partial<Record<0 | 1, true>> = {};
        if (!table) {
            return next;
        }
        for (const slot of [0, 1] as const) {
            const holder = table.markers[slot];
            if (askedSlots[slot] && holder && holder !== me.id) {
                next[slot] = true;
            }
        }
        return next;
    }, [askedSlots, me.id, table]);

    useEffect(() => {
        if (!keptTick) {
            return;
        }
        setAskedSlots((current) => {
            if (!current[keptTick.slot]) {
                return current;
            }
            const next = { ...current };
            delete next[keptTick.slot];
            return next;
        });
    }, [keptTick]);

    if (door !== "joined" || !table) {
        return null;
    }

    return (
        <div className={drawerOpen ? "table-shell drawer-open" : "table-shell"}>
            <header className="table-rail">
                <div className="rail-brand">
                    <p className="rail-name">{table.name || "Untitled sitting"}</p>
                    <p className="rail-meta">
                        {table.usedSeats} / {table.maxSeats} seats
                        <span className="fuse">{remainingLabel(table.expiresAt, now)}</span>
                    </p>
                </div>
                <ul className="seats">
                    {table.seats.map((seat) => {
                        const speaking = speakingIds.includes(seat.id) && !seat.muted;
                        return (
                            <li
                                key={seat.id}
                                className={seat.id === me.id ? "seat seat-me" : "seat"}
                            >
                                <span className="seat-name">
                                    {seat.name}
                                    {seat.id === table.hostParticipantId ? " (host)" : ""}
                                </span>
                                <span
                                    className={
                                        seat.muted
                                            ? "seat-mic mic-off"
                                            : speaking
                                              ? "seat-mic mic-on seat-mic-speaking"
                                              : "seat-mic mic-on"
                                    }
                                >
                                    <span aria-hidden="true">
                                        {seat.muted ? <MicOffIcon /> : <MicIcon />}
                                    </span>
                                    {speaking ? <span className="sr-only">speaking</span> : null}
                                </span>
                                {isHost && seat.id !== me.id ? (
                                    <button
                                        aria-label={`Mute ${seat.name}`}
                                        className="icon-btn icon-btn-quiet"
                                        onClick={() => onMute(seat.id)}
                                        title={`Mute ${seat.name}`}
                                        type="button"
                                    >
                                        <MicOffIcon />
                                    </button>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
                <div className="rail-actions">
                    <button
                        aria-label={
                            voiceConfigured === false
                                ? "Voice not configured"
                                : micOn
                                  ? "Mute microphone"
                                  : "Unmute microphone"
                        }
                        aria-pressed={micOn}
                        className={
                            micOn && speakingIds.includes(me.id)
                                ? "icon-btn icon-btn-speaking"
                                : "icon-btn"
                        }
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
                {(isHost && table.waiters.length > 0) || asks.length > 0 ? (
                    <div className="table-queues">
                        {isHost && table.waiters.length > 0 ? (
                            <aside className="knock-list">
                                <p>At the door</p>
                                <ul>
                                    {table.waiters.map((waiter) => (
                                        <li key={waiter.id}>
                                            <span>{waiter.name}</span>
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
                        ) : null}
                        {asks.length > 0 ? (
                            <aside className="knock-list">
                                <p>Want a pen</p>
                                <ul>
                                    {asks.map((ask) => (
                                        <li key={ask.requestId}>
                                            <span>
                                                {ask.fromName}
                                                <em> · {MARKER_NAMES[ask.slot]}</em>
                                            </span>
                                            <button
                                                className="btn btn-brass"
                                                onClick={() => onAnswer(ask.requestId, true)}
                                                type="button"
                                            >
                                                Pass
                                            </button>
                                            <button
                                                className="btn btn-ghost"
                                                onClick={() => onAnswer(ask.requestId, false)}
                                                type="button"
                                            >
                                                Keep
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </aside>
                        ) : null}
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
                    onScene={onScene}
                    onCursor={onCursor}
                />
                <div className="pen-tray" aria-label="Markers">
                    {([0, 1] as const).map((slot) => (
                        <Pen
                            key={slot}
                            slot={slot}
                            holderId={table.markers[slot]}
                            holderName={personName(table.seats, table.markers[slot])}
                            meId={me.id}
                            seats={table.seats}
                            isHost={isHost}
                            asked={Boolean(asked[slot])}
                            onTake={onTake}
                            onDrop={onDrop}
                            onGive={onGive}
                            onAsk={(holderId) => {
                                setAskedSlots((current) => ({ ...current, [slot]: true }));
                                onAsk(holderId);
                            }}
                            onHostTake={onHostTake}
                        />
                    ))}
                </div>
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
                <button className="drawer-item" onClick={() => onCopy("Guest link", guestUrl)} type="button">
                    <LinkIcon />
                    Copy guest door
                </button>
                {isHost && hostUrl ? (
                    <button className="drawer-item" onClick={() => onCopy("Host link", hostUrl)} type="button">
                        <KeyIcon />
                        Copy host door
                    </button>
                ) : null}
                {isHost ? (
                    <>
                        <button
                            className="drawer-item"
                            onClick={() => onMode(table.accessMode === "knock" ? "open" : "knock")}
                            title={
                                table.accessMode === "knock"
                                    ? "Guest links sit down. People who knock from the house still wait."
                                    : "The house floor can walk in without knocking."
                            }
                            type="button"
                        >
                            <DoorIcon />
                            {table.accessMode === "knock" ? "Open house" : "House knocks"}
                        </button>
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

function Pen({
    slot,
    holderId,
    holderName,
    meId,
    seats,
    isHost,
    asked,
    onTake,
    onDrop,
    onGive,
    onAsk,
    onHostTake,
}: {
    slot: 0 | 1;
    holderId: string | null;
    holderName: string | null;
    meId: string;
    seats: PresencePerson[];
    isHost: boolean;
    asked: boolean;
    onTake: (slot: 0 | 1) => void;
    onDrop: (slot: 0 | 1) => void;
    onGive: (slot: 0 | 1, toParticipantId: string) => void;
    onAsk: (holderId: string) => void;
    onHostTake: (slot: 0 | 1) => void;
}) {
    const others = seats.filter((seat) => seat.id !== meId);
    const mine = holderId === meId;
    const free = holderId === null;
    const label = MARKER_NAMES[slot];
    const who = holderName ?? "someone";
    const Icon = slot === 0 ? MarkerOneIcon : MarkerTwoIcon;
    const status = free
        ? "On the table"
        : mine
          ? "In your hand"
          : `Held by ${who}`;

    return (
        <article
            className={`pen-card pen-${slot === 0 ? "one" : "two"}${mine ? " pen-mine" : ""}${free ? " pen-free" : ""}`}
        >
            <div className="pen-card-head">
                <span className="pen-stick" aria-hidden="true">
                    <Icon />
                </span>
                <div>
                    <p className="pen-label">{label}</p>
                    <p className="pen-status">{asked ? `Asked ${who}` : status}</p>
                </div>
            </div>
            <div className="pen-verbs">
                {free ? (
                    <button className="pen-verb" onClick={() => onTake(slot)} type="button">
                        Pick up
                    </button>
                ) : null}
                {mine ? (
                    <>
                        <button className="pen-verb" onClick={() => onDrop(slot)} type="button">
                            Put down
                        </button>
                        {others.length > 0 ? (
                            <label className="pen-pass">
                                <span className="sr-only">Pass {label} to</span>
                                <select
                                    defaultValue=""
                                    onChange={(event) => {
                                        const next = event.target.value;
                                        event.target.value = "";
                                        if (next) {
                                            onGive(slot, next);
                                        }
                                    }}
                                >
                                    <option disabled value="">
                                        Pass to
                                    </option>
                                    {others.map((seat) => (
                                        <option key={seat.id} value={seat.id}>
                                            {seat.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        ) : null}
                    </>
                ) : null}
                {!free && !mine ? (
                    <>
                        <button
                            className="pen-verb"
                            disabled={asked}
                            onClick={() => holderId && onAsk(holderId)}
                            type="button"
                        >
                            {asked ? "Asked" : `Ask ${who}`}
                        </button>
                        {isHost ? (
                            <button className="pen-verb" onClick={() => onHostTake(slot)} type="button">
                                Take
                            </button>
                        ) : null}
                    </>
                ) : null}
            </div>
        </article>
    );
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
