"use client";

import { Room, RoomEvent } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { fetchLivekitToken } from "../lib/api";

export function useVoice(options: {
    enabled: boolean;
    token: string | null;
    slug: string;
}) {
    const roomRef = useRef<Room | null>(null);
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [micOn, setMicOn] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!options.enabled || !options.token) {
            return;
        }

        let cancelled = false;
        const room = new Room();
        roomRef.current = room;

        (async () => {
            try {
                const minted = await fetchLivekitToken(options.token!, options.slug);
                if (cancelled) {
                    return;
                }
                if (!minted.configured || !minted.token || !minted.url) {
                    setConfigured(false);
                    return;
                }
                setConfigured(true);
                await room.connect(minted.url, minted.token);
                await room.localParticipant.setMicrophoneEnabled(false);
                setMicOn(false);
            } catch (err) {
                console.error(err);
                if (!cancelled) {
                    setConfigured(false);
                    setError("Voice not configured");
                }
            }
        })();

        room.on(RoomEvent.Disconnected, () => {
            setMicOn(false);
        });

        return () => {
            cancelled = true;
            void room.disconnect();
            roomRef.current = null;
        };
    }, [options.enabled, options.token, options.slug]);

    async function setMicrophone(enabled: boolean) {
        const room = roomRef.current;
        if (!room || configured === false) {
            return;
        }
        await room.localParticipant.setMicrophoneEnabled(enabled);
        setMicOn(enabled);
    }

    async function forceMute() {
        await setMicrophone(false);
    }

    return { configured, micOn, error, setMicrophone, forceMute };
}
