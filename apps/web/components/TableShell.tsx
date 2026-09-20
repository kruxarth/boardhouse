"use client";

import { useEffect, useMemo, useState } from "react";
import type { PresencePerson } from "@repo/common/types";
import { BoardCanvas, type RemoteCursor } from "./BoardCanvas";
import {
    AskIcon,
    CloseIcon,
    DoorIcon,
    DownloadIcon,
    DrawerIcon,
    GrabIcon,
    KeyIcon,
    LinkIcon,
    MarkerOneIcon,
    MarkerTwoIcon,
    MicIcon,
    MicOffIcon,
    PlayIcon,
    PutDownIcon,
    RotateIcon,
    WipeIcon,
} from "./Icons";

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
    onExport,
    onCopy,
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
    onExport: () => void;
    onCopy: (label: string, value: string) => void;
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
                    <div className="pen-row">
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
                                                Give
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
            </div>

            <aside className="table-drawer" hidden={!drawerOpen} id="table-drawer">
                <p className="drawer-kicker">Table tools</p>
                <button className="drawer-item" onClick={onExport} type="button">
                    <DownloadIcon />
                    Export sitting
                </button>
                <a className="drawer-item" href="/replay">
                    <PlayIcon />
                    Replay
                </a>
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
    const who = free ? "Free" : mine ? "Yours" : holderName ?? "Taken";
    const Icon = slot === 0 ? MarkerOneIcon : MarkerTwoIcon;
    const status = free
        ? "On the table. Pick it up."
        : mine
          ? "In your hand."
          : asked
            ? `Asked ${who} for it.`
            : `${who} is holding it. Ask for it.`;

    return (
        <div className={`pen pen-${slot === 0 ? "one" : "two"}${mine ? " pen-mine" : ""}${free ? " pen-free" : ""}`}>
            <button
                aria-label={`${label}. ${status}`}
                aria-pressed={mine}
                className="pen-body"
                disabled={asked || mine}
                onClick={() => {
                    if (free) {
                        onTake(slot);
                    } else if (holderId) {
                        onAsk(holderId);
                    }
                }}
                title={status}
                type="button"
            >
                <span className="pen-nib" aria-hidden="true">
                    <Icon />
                </span>
                <span className="pen-who">{asked ? "Asked" : who}</span>
            </button>
            {mine ? (
                <div className="pen-actions">
                    {others.length > 0 ? (
                        <div className="pen-people" role="group" aria-label={`Hand ${label} to`}>
                            {others.map((seat) => (
                                <button
                                    key={seat.id}
                                    className="pen-hand"
                                    onClick={() => onGive(slot, seat.id)}
                                    title={`Hand to ${seat.name}`}
                                    type="button"
                                >
                                    {seat.name}
                                </button>
                            ))}
                        </div>
                    ) : null}
                    <button
                        aria-label={`Put ${label} down`}
                        className="icon-btn icon-btn-quiet"
                        onClick={() => onDrop(slot)}
                        title="Put down"
                        type="button"
                    >
                        <PutDownIcon />
                    </button>
                </div>
            ) : null}
            {!free && !mine ? (
                <div className="pen-actions">
                    <button
                        aria-label={asked ? `Waiting for ${who}` : `Ask ${who} for ${label}`}
                        className="icon-btn icon-btn-quiet"
                        disabled={asked}
                        onClick={() => holderId && onAsk(holderId)}
                        title={asked ? "Asked" : "Ask for this pen"}
                        type="button"
                    >
                        <AskIcon />
                    </button>
                    {isHost ? (
                        <button
                            aria-label={`Take ${label}`}
                            className="icon-btn icon-btn-quiet"
                            onClick={() => onHostTake(slot)}
                            title="Take this pen"
                            type="button"
                        >
                            <GrabIcon />
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
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
