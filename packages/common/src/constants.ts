export const MAX_ROOMS = 10;
export const MAX_SEATS = 10;
export const MAX_WAITERS = 20;
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
/** Same length as a sitting; jwt.sign treats a number as seconds. */
export const SESSION_TTL_SECONDS = Math.floor(ROOM_TTL_MS / 1000);
export const MAX_CANVAS_MESSAGE_BYTES = 600_000;
/** Enough frames for a 60s recap without keeping a 12-hour film. */
export const MAX_REPLAY_EVENTS = 480;
export const MAX_REPLAY_BYTES = 4_000_000;
/** Collapse burst strokes into one frame so the buffer spans the sitting. */
export const MIN_REPLAY_CANVAS_GAP_MS = 2_000;
/** How long a marker holder has to answer before the ask lapses. */
export const ASK_WINDOW_MS = 9_000;
/** A holder who has not drawn or moved in this long passes the marker on ask. */
export const HOLDER_IDLE_MS = 45_000;
/** Breathing room after a refused or lapsed ask before the same slot can be asked again. */
export const ASK_COOLDOWN_MS = 8_000;
export const REACTION_MIN_GAP_MS = 800;
/** One per seat, handed out so no two people at a table share a face. */
export const AVATAR_COUNT = MAX_SEATS;
export const REACTIONS = ["👍", "🔥", "😂", "🎉", "👀", "❤️"] as const;
export type Reaction = (typeof REACTIONS)[number];

/** Browsers sometimes drop the emoji variation selector. Compare the picture, not the bytes. */
export function asReaction(value: string): Reaction | null {
    const needle = value.replace(/\uFE0E|\uFE0F/g, "");
    return REACTIONS.find((emoji) => emoji.replace(/\uFE0E|\uFE0F/g, "") === needle) ?? null;
}
