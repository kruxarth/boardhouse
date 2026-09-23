import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } from "./secrets";

export function livekitConfigured() {
    return Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
}

export function livekitRoomName(slug: string) {
    return `board-house-${slug}`;
}

export async function mintLivekitToken(options: {
    identity: string;
    name: string;
    slug: string;
}) {
    if (!livekitConfigured()) {
        return null;
    }

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: options.identity,
        name: options.name,
        ttl: "24h",
    });

    at.addGrant({
        roomJoin: true,
        room: livekitRoomName(options.slug),
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
        canPublishSources: [TrackSource.MICROPHONE],
    });

    return {
        token: await at.toJwt(),
        url: LIVEKIT_URL,
    };
}

export async function deleteLivekitRoom(slug: string) {
    await deleteLivekitRooms([slug]);
}

export async function deleteLivekitRooms(slugs: string[]) {
    if (!livekitConfigured() || slugs.length === 0) {
        return;
    }
    const client = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    for (const slug of slugs) {
        try {
            await client.deleteRoom(livekitRoomName(slug));
        } catch {
            // Room may never have been created.
        }
    }
}
