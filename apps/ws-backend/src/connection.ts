import type { WebSocket } from "ws";
import type { LiveRoom } from "./store";

export type Session = {
    participantId: string;
    name: string;
};

export type Connection = {
    ws: WebSocket;
    session: Session | null;
    room: LiveRoom | null;
    viaFormerSlug: boolean;
    authTimer?: ReturnType<typeof setTimeout>;
};

export function clearAuthTimeout(connection: Connection) {
    if (connection.authTimer) {
        clearTimeout(connection.authTimer);
        connection.authTimer = undefined;
    }
}
