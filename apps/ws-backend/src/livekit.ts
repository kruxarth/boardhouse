import { RoomServiceClient } from "livekit-server-sdk";
import {
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
    LIVEKIT_URL,
} from "@repo/backend-common/config";

function livekitConfigured() {
    return Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
}

function livekitRoomName(slug: string) {
    return `board-house-${slug}`;
}

export async function deleteLivekitRooms(slugs: string[]) {
    if (!livekitConfigured()) {
        return;
    }
    const client = new RoomServiceClient(
        LIVEKIT_URL,
        LIVEKIT_API_KEY,
        LIVEKIT_API_SECRET
    );
    for (const slug of slugs) {
        try {
            await client.deleteRoom(livekitRoomName(slug));
        } catch {
            // Room may never have been created.
        }
    }
}
