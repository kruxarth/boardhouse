import { useEffect, useState } from "react";
import { WS_BACKEND_URL } from "../app/config";
import { WAKE_BUDGET_MS } from "../lib/wake";

function socketUrl(token: string) {
    const base = WS_BACKEND_URL.replace(/\/$/, "");
    return `${base}/?token=${encodeURIComponent(token)}`;
}

export function useSocket(token: string | null) {
    const [loading, setLoading] = useState(true);
    const [socket, setSocket] = useState<WebSocket | null>(null);
    const [failed, setFailed] = useState(false);
    const [waking, setWaking] = useState(false);

    useEffect(() => {
        if (!token) {
            setSocket(null);
            setLoading(true);
            setFailed(false);
            setWaking(false);
            return;
        }

        let stopped = false;
        let ws: WebSocket | null = null;
        let attempt = 0;
        let failingSince = 0;
        let retryTimer: number | undefined;
        const sessionToken = token;

        function connect() {
            if (stopped) {
                return;
            }

            const next = new WebSocket(socketUrl(sessionToken));
            ws = next;

            next.addEventListener("open", () => {
                if (stopped || ws !== next) {
                    next.close();
                    return;
                }
                attempt = 0;
                failingSince = 0;
                setFailed(false);
                setWaking(false);
                setLoading(false);
                setSocket(next);
            });

            next.addEventListener("close", (event) => {
                setSocket((current) => (current === next ? null : current));
                if (stopped) {
                    return;
                }
                if (event.code === 1008 || event.code === 4000 || event.code === 4001) {
                    // 1008: bad session (retrying won't help).
                    // 4000: sitting wiped. 4001: replaced by another tab (must not fight it).
                    setFailed(event.code === 1008);
                    setWaking(false);
                    setLoading(false);
                    return;
                }
                attempt += 1;
                failingSince ||= Date.now();
                if (Date.now() - failingSince > WAKE_BUDGET_MS) {
                    setFailed(true);
                    setWaking(false);
                    setLoading(false);
                    return;
                }
                if (attempt >= 2) {
                    setWaking(true);
                }
                setLoading(true);
                retryTimer = window.setTimeout(connect, Math.min(800 * attempt, 5_000));
            });
        }

        setLoading(true);
        setFailed(false);
        setWaking(false);
        connect();

        return () => {
            stopped = true;
            if (retryTimer) {
                window.clearTimeout(retryTimer);
            }
            ws?.close();
            setSocket(null);
        };
    }, [token]);

    return { socket, loading, failed, waking };
}
