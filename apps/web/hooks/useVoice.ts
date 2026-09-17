"use client";

import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
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
        const audioElements = new Map<RemoteTrack, HTMLMediaElement>();

        function attachAudio(track: RemoteTrack) {
            if (track.kind !== Track.Kind.Audio) {
                return;
            }
            const element = track.attach();
            element.style.display = "none";
            document.body.appendChild(element);
            audioElements.set(track, element);
        }

        function detachAudio(track: RemoteTrack) {
            for (const element of track.detach()) {
                element.remove();
            }
            audioElements.delete(track);
        }

        function handleDisconnected() {
            setMicOn(false);
        }

        room.on(RoomEvent.TrackSubscribed, attachAudio);
        room.on(RoomEvent.TrackUnsubscribed, detachAudio);
        room.on(RoomEvent.Disconnected, handleDisconnected);

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

        return () => {
            cancelled = true;
            room.off(RoomEvent.TrackSubscribed, attachAudio);
            room.off(RoomEvent.TrackUnsubscribed, detachAudio);
            room.off(RoomEvent.Disconnected, handleDisconnected);
            for (const element of audioElements.values()) {
                element.remove();
            }
            audioElements.clear();
            void room.disconnect();
            roomRef.current = null;
        };
    }, [options.enabled, options.token, options.slug]);

    async function setMicrophone(enabled: boolean) {
        const room = roomRef.current;
        if (!room || configured === false) {
            return;
        }
        if (enabled) {
            void room.startAudio().catch(() => undefined);
        }
        await room.localParticipant.setMicrophoneEnabled(enabled);
        setMicOn(enabled);
    }

    async function forceMute() {
        await setMicrophone(false);
    }

    return { configured, micOn, error, setMicrophone, forceMute };
}
