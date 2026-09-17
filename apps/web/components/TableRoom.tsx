"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RoomStatePayload } from "@repo/common/types";
import { useLocalSession } from "../hooks/useLocalSession";
import { useSocket } from "../hooks/useSocket";
import { useVoice } from "../hooks/useVoice";
import { createSession, fetchRoom } from "../lib/api";
import { rememberHostKey, readHostKey, clearSession } from "../lib/session";
import type { RemoteCursor } from "./BoardCanvas";
import { DoorScreen } from "./DoorScreen";
import { NameGate } from "./NameGate";
import { doorCopy, TableShell, type TableModel } from "./TableShell";

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
    return {
        slug: state.slug,
        name: state.name,
        accessMode: state.accessMode,
        expiresAt: state.expiresAt,
        hostParticipantId: state.hostParticipantId,
        seats: state.seats,
        waiters: state.waiters,
        markers: state.markers,
        viaFormerSlug: state.viaFormerSlug,
        usedSeats: state.usedSeats,
        maxSeats: state.maxSeats,
    };
}

export function TableRoom({ slug, hostKeyFromUrl }: { slug: string; hostKeyFromUrl: string | null }) {
    const router = useRouter();
    const { session, setSession, ready } = useLocalSession();
    const [door, setDoor] = useState<DoorKind>("connecting");
    const [doorMessage, setDoorMessage] = useState("");
    const [table, setTable] = useState<TableModel | null>(null);
    const [snapshot, setSnapshot] = useState<unknown>(null);
    const [remoteScene, setRemoteScene] = useState<unknown>(null);
    const [cursors, setCursors] = useState<RemoteCursor[]>([]);
    const [ask, setAsk] = useState<{
        requestId: string;
        fromParticipantId: string;
        fromName: string;
        slot: 0 | 1;
    } | null>(null);
    const [now, setNow] = useState(Date.now());
    const [toast, setToast] = useState<string | null>(null);
    const [namePending, setNamePending] = useState(false);
    const hostKey = hostKeyFromUrl || (ready ? readHostKey(slug) : null);
    const { socket, loading, failed } = useSocket(session?.token ?? null);
    const joined = door === "joined";
    const voice = useVoice({
        enabled: joined,
        token: session?.token ?? null,
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
            setDoor("need-name");
        }
    }, [ready, session]);

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
        if (!socket || loading || !session) {
            return;
        }

        const ws = socket;
        let settled = false;
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
                token: session.token,
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
            if (type === "room_state") {
                const state = message as unknown as RoomStatePayload;
                setTable(asTable(state));
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
                    setAsk((current) => {
                        if (!current) {
                            return current;
                        }
                        if (slots[current.slot] !== session.participantId) {
                            return null;
                        }
                        return current;
                    });
                }
                return;
            }
            if (type === "marker_ask") {
                setAsk({
                    requestId: String(message.requestId),
                    fromParticipantId: String(message.fromParticipantId),
                    fromName: String(message.fromName ?? "Someone"),
                    slot: message.slot === 1 ? 1 : 0,
                });
                return;
            }
            if (type === "canvas_snapshot") {
                setSnapshot(message.payload);
                return;
            }
            if (type === "canvas") {
                setRemoteScene(message.payload);
                return;
            }
            if (type === "cursor") {
                const id = String(message.participantId);
                setCursors((current) => {
                    const next = current.filter((item) => item.id !== id);
                    next.push({
                        id,
                        name: String(message.name ?? ""),
                        x: Number(message.x),
                        y: Number(message.y),
                    });
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
                const blob = new Blob([JSON.stringify(payload, null, 2)], {
                    type: "application/json",
                });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `board-house-${slugRef.current}.json`;
                link.click();
                URL.revokeObjectURL(link.href);
                setToast("Replay downloaded");
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
            ws.removeEventListener("close", onClose);
            ws.onmessage = null;
        };
    }, [socket, loading, session, slug, hostKey, router, setSession]);

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
            setSession(next);
            setDoor("connecting");
        } catch {
            setDoor("error");
            setDoorMessage("Could not start a session");
        } finally {
            setNamePending(false);
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
                cursors={cursors.filter((cursor) => cursor.id !== session.participantId)}
                ask={ask}
                now={now}
                voiceConfigured={voice.configured}
                micOn={voice.micOn}
                onScene={(payload) => send({ type: "canvas", payload })}
                onCursor={(x, y) => send({ type: "cursor", x, y })}
                onTake={(slot) => send({ type: "take_marker", slot })}
                onDrop={(slot) => send({ type: "drop_marker", slot })}
                onGive={(slot, toParticipantId) => send({ type: "give_marker", slot, toParticipantId })}
                onAsk={(fromParticipantId) => send({ type: "ask_marker", fromParticipantId })}
                onAnswer={(requestId, give) => {
                    send({ type: "answer_marker", requestId, give });
                    setAsk(null);
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
                onExport={() => send({ type: "get_replay" })}
                onCopy={copy}
            />
            {toast ? (
                <p className="toast" role="status">
                    {toast}
                </p>
            ) : null}
        </>
    );
}
