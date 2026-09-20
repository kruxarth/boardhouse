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
