"use client";

import { useState } from "react";
import type { PresencePerson } from "@repo/common/types";
import { BoardCanvas, type RemoteCursor } from "./BoardCanvas";
import { MarkerOneIcon, MarkerTwoIcon, MicIcon, MicOffIcon } from "./Icons";

type DoorKind = "connecting" | "waiting" | "denied" | "full" | "expired" | "missing" | "error";

type MarkerAsk = {
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

const MARKER_NAMES = ["Marker one", "Marker two"] as const;

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
    doorMessage,
    table,
    canDraw,
    snapshot,
    remoteScene,
    cursors,
    ask,
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
    ask: MarkerAsk | null;
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
    onAsk: (fromParticipantId: string) => void;
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
    onExport: () => void;
    onCopy: (label: string, value: string) => void;
}) {
    const [confirmEnd, setConfirmEnd] = useState(false);
    const isHost = Boolean(table && table.hostParticipantId === me.id);
    const guestUrl = table ? `${typeof window !== "undefined" ? window.location.origin : ""}/room/${table.slug}` : "";
    const hostUrl =
        table && hostKey
            ? `${guestUrl}?host=${hostKey}`
            : "";

    if (door !== "joined" || !table) {
        return null;
    }

    return (
        <div className="table-shell">
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
                                    className="btn btn-tiny"
                                    onClick={() => onMute(seat.id)}
                                    type="button"
                                >
                                    Mute
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
                    <div className="marker-row">
                        {([0, 1] as const).map((slot) => (
                            <MarkerChip
                                key={slot}
                                slot={slot}
                                holderId={table.markers[slot]}
                                holderName={personName(table.seats, table.markers[slot])}
                                meId={me.id}
                                seats={table.seats}
                                isHost={isHost}
                                onTake={onTake}
                                onDrop={onDrop}
                                onGive={onGive}
                                onAsk={onAsk}
                                onHostTake={onHostTake}
                                onHostGive={onHostGive}
                            />
                        ))}
                    </div>
                    <button className="btn btn-ghost btn-tiny" onClick={onExport} type="button">
                        Export
                    </button>
                    <a className="btn btn-ghost btn-tiny" href="/replay">
                        Replay
                    </a>
                    {isHost ? (
                        confirmEnd ? (
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
                            <div className="host-tools">
                                <button
                                    className="btn btn-ghost btn-tiny"
                                    onClick={() => onMode(table.accessMode === "knock" ? "open" : "knock")}
                                    title={
                                        table.accessMode === "knock"
                                            ? "Guest links sit down. People who knock from the house still wait."
                                            : "The house floor can walk in without knocking."
                                    }
                                    type="button"
                                >
                                    {table.accessMode === "knock" ? "Open house" : "House knocks"}
                                </button>
                                <button
                                    aria-label="Issue a new guest URL. Anyone with the old link has to knock."
                                    className="btn btn-ghost btn-tiny"
                                    onClick={onRotate}
                                    title="Issues a new guest URL. Anyone with the old link has to knock."
                                    type="button"
                                >
                                    Change guest URL
                                </button>
                                <button
                                    className="btn btn-ghost btn-tiny"
                                    onClick={() => onCopy("Guest link", guestUrl)}
                                    type="button"
                                >
                                    Guest
                                </button>
                                {hostUrl ? (
                                    <button
                                        className="btn btn-ghost btn-tiny"
                                        onClick={() => onCopy("Host link", hostUrl)}
                                        type="button"
                                    >
                                        Host
                                    </button>
                                ) : null}
                                <button
                                    className="btn btn-ghost btn-tiny"
                                    onClick={() => setConfirmEnd(true)}
                                    title="Wipe this table now, for everyone"
                                    type="button"
                                >
                                    End sitting
                                </button>
                            </div>
                        )
                    ) : null}
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
            {ask ? (
                <div className="ask-banner">
                    <p>
                        {ask.fromName} asked for {MARKER_NAMES[ask.slot]}.
                    </p>
                    <button className="btn btn-brass" onClick={() => onAnswer(ask.requestId, true)} type="button">
                        Give
                    </button>
                    <button className="btn btn-ghost" onClick={() => onAnswer(ask.requestId, false)} type="button">
                        Keep
                    </button>
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

            {table.viaFormerSlug && !isHost ? (
                <p className="note">This link was rotated. The host has to let you in.</p>
            ) : null}
        </div>
    );
}

function MarkerChip({
    slot,
    holderId,
    holderName,
    meId,
    seats,
    isHost,
    onTake,
    onDrop,
    onGive,
    onAsk,
    onHostTake,
    onHostGive,
}: {
    slot: 0 | 1;
    holderId: string | null;
    holderName: string | null;
    meId: string;
    seats: PresencePerson[];
    isHost: boolean;
    onTake: (slot: 0 | 1) => void;
    onDrop: (slot: 0 | 1) => void;
    onGive: (slot: 0 | 1, toParticipantId: string) => void;
    onAsk: (fromParticipantId: string) => void;
    onHostTake: (slot: 0 | 1) => void;
    onHostGive: (slot: 0 | 1, toParticipantId: string) => void;
}) {
    const [giveTo, setGiveTo] = useState("");
    const others = seats.filter((seat) => seat.id !== meId);
    const mine = holderId === meId;
    const free = holderId === null;
    const tone = slot === 0 ? "one" : "two";

    const label = MARKER_NAMES[slot];
    const status = free ? "On the table" : mine ? "In your hand" : holderName ?? "Taken";
    const Icon = slot === 0 ? MarkerOneIcon : MarkerTwoIcon;

    return (
        <div className={`marker marker-${tone}`}>
            <button
                aria-label={`${label}. ${status}`}
                aria-pressed={mine}
                className="icon-btn"
                onClick={() => {
                    if (free) {
                        onTake(slot);
                    } else if (mine) {
                        onDrop(slot);
                    } else if (holderId) {
                        onAsk(holderId);
                    }
                }}
                title={`${label} — ${status}`}
                type="button"
            >
                <Icon />
                <span className="sr-only">{label}</span>
            </button>
            <span className="marker-held">{mine ? "Yours" : free ? "Free" : holderName}</span>
            {mine && others.length > 0 ? (
                <label className="give">
                    <select
                        value={giveTo}
                        onChange={(event) => setGiveTo(event.target.value)}
                    >
                        <option value="">Give to…</option>
                        {others.map((seat) => (
                            <option key={seat.id} value={seat.id}>
                                {seat.name}
                            </option>
                        ))}
                    </select>
                    <button
                        className="btn btn-tiny"
                        disabled={!giveTo}
                        onClick={() => {
                            if (giveTo) {
                                onGive(slot, giveTo);
                                setGiveTo("");
                            }
                        }}
                        type="button"
                    >
                        Give
                    </button>
                </label>
            ) : null}
            {isHost && !free && !mine ? (
                <button className="btn btn-tiny" onClick={() => onHostTake(slot)} type="button">
                    Take
                </button>
            ) : null}
            {isHost && !mine && others.length > 0 ? (
                <label className="give">
                    <select
                        value={giveTo}
                        onChange={(event) => setGiveTo(event.target.value)}
                    >
                        <option value="">Hand to…</option>
                        {others.map((seat) => (
                            <option key={seat.id} value={seat.id}>
                                {seat.name}
                            </option>
                        ))}
                    </select>
                    <button
                        className="btn btn-tiny"
                        disabled={!giveTo}
                        onClick={() => {
                            if (giveTo) {
                                onHostGive(slot, giveTo);
                                setGiveTo("");
                            }
                        }}
                        type="button"
                    >
                        Give
                    </button>
                </label>
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

