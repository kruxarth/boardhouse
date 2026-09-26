"use client";

import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { fetchLivekitToken } from "../lib/api";

function speakingIdentities(room: Room) {
    const ids: string[] = [];
    if (room.localParticipant.isSpeaking) {
        ids.push(room.localParticipant.identity);
    }
    for (const participant of room.remoteParticipants.values()) {
        if (participant.isSpeaking) {
            ids.push(participant.identity);
        }
    }
    ids.sort();
    return ids;
}

function sameIds(left: string[], right: string[]) {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function useVoice(options: {
    enabled: boolean;
    token: string | null;
    slug: string;
}) {
    const roomRef = useRef<Room | null>(null);
    const speakingRef = useRef<string[]>([]);
    const dismissedRef = useRef(false);
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [micOn, setMicOn] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [unlockNeeded, setUnlockNeeded] = useState(false);
    const [speakingIds, setSpeakingIds] = useState<string[]>([]);
    // A rename swaps the token; voice keeps its connection and only needs a token to mint one.
    const tokenRef = useRef(options.token);
    tokenRef.current = options.token;
    const hasToken = options.token !== null;

    useEffect(() => {
        if (!options.enabled || !hasToken) {
            return;
        }

        let cancelled = false;
        dismissedRef.current = false;
        const room = new Room();
        roomRef.current = room;
        const audioElements = new Map<RemoteTrack, HTMLMediaElement>();

        function publishSpeaking() {
            const next = speakingIdentities(room);
            if (sameIds(speakingRef.current, next)) {
                return;
            }
            speakingRef.current = next;
            setSpeakingIds(next);
        }

        function attachAudio(track: RemoteTrack) {
            if (track.kind !== Track.Kind.Audio) {
                return;
            }
            const element = track.attach();
            element.style.display = "none";
            document.body.appendChild(element);
            audioElements.set(track, element);
            refreshUnlock();
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

        function hasCompany() {
            if (room.remoteParticipants.size > 0) {
                return true;
            }
            for (const participant of room.remoteParticipants.values()) {
                for (const publication of participant.audioTrackPublications.values()) {
                    if (publication.isSubscribed || publication.track) {
                        return true;
                    }
                }
            }
            return false;
        }

        function refreshUnlock() {
            if (!hasCompany()) {
                setUnlockNeeded(false);
                return;
            }
            if (!dismissedRef.current) {
                setUnlockNeeded(true);
            }
        }

        function handlePlayback() {
            refreshUnlock();
        }

        room.on(RoomEvent.TrackSubscribed, attachAudio);
        room.on(RoomEvent.TrackUnsubscribed, detachAudio);
        room.on(RoomEvent.Disconnected, handleDisconnected);
        room.on(RoomEvent.ActiveSpeakersChanged, publishSpeaking);
        room.on(RoomEvent.AudioPlaybackStatusChanged, handlePlayback);
        room.on(RoomEvent.ParticipantConnected, refreshUnlock);
        room.on(RoomEvent.ParticipantDisconnected, refreshUnlock);

        (async () => {
            try {
                const minted = await fetchLivekitToken(tokenRef.current ?? "", options.slug);
                if (cancelled) {
                    return;
                }
                if (!minted.configured || !minted.token || !minted.url) {
                    setConfigured(false);
                    setUnlockNeeded(false);
                    return;
                }
                setConfigured(true);
                await room.connect(minted.url, minted.token);
                await room.localParticipant.setMicrophoneEnabled(false);
                setMicOn(false);
                refreshUnlock();
                publishSpeaking();
            } catch (err) {
                console.error(err);
                if (!cancelled) {
                    setConfigured(false);
                    setUnlockNeeded(false);
                    setError("Voice not configured");
                }
            }
        })();

        return () => {
            cancelled = true;
            room.off(RoomEvent.TrackSubscribed, attachAudio);
            room.off(RoomEvent.TrackUnsubscribed, detachAudio);
            room.off(RoomEvent.Disconnected, handleDisconnected);
            room.off(RoomEvent.ActiveSpeakersChanged, publishSpeaking);
            room.off(RoomEvent.AudioPlaybackStatusChanged, handlePlayback);
            room.off(RoomEvent.ParticipantConnected, refreshUnlock);
            room.off(RoomEvent.ParticipantDisconnected, refreshUnlock);
            for (const element of audioElements.values()) {
                element.remove();
            }
            audioElements.clear();
            speakingRef.current = [];
            setSpeakingIds([]);
            void room.disconnect();
            roomRef.current = null;
        };
    }, [options.enabled, hasToken, options.slug]);

    async function unlockPlayback() {
        const room = roomRef.current;
        dismissedRef.current = true;
        setUnlockNeeded(false);
        if (!room || configured === false) {
            return false;
        }
        try {
            await room.startAudio();
        } catch {
            return false;
        }
        return room.canPlaybackAudio;
    }

    async function allowMicrophone() {
        const room = roomRef.current;
        dismissedRef.current = true;
        setUnlockNeeded(false);
        if (!room || configured === false) {
            return false;
        }
        await room.startAudio().catch(() => undefined);
        try {
            await room.localParticipant.setMicrophoneEnabled(true);
            setMicOn(true);
            return true;
        } catch {
            setMicOn(false);
            return false;
        }
    }

    async function setMicrophone(enabled: boolean) {
        const room = roomRef.current;
        if (!room || configured === false) {
            return;
        }
        if (enabled) {
            void room.startAudio().catch(() => undefined);
            dismissedRef.current = true;
            setUnlockNeeded(false);
        }
        await room.localParticipant.setMicrophoneEnabled(enabled);
        setMicOn(enabled);
        if (enabled) {
            setUnlockNeeded(false);
        }
    }

    async function forceMute() {
        await setMicrophone(false);
    }

    return {
        configured,
        micOn,
        error,
        unlockNeeded,
        speakingIds,
        setMicrophone,
        allowMicrophone,
        unlockPlayback,
        forceMute,
    };
}
