import { useEffect, useState } from "react";
import { WS_BACKEND_URL } from "../app/config";

export function useSocket(token: string | null) {
    const [loading, setLoading] = useState(true);
    const [socket, setSocket] = useState<WebSocket | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!token) {
            setSocket(null);
            setLoading(true);
            setFailed(false);
            return;
        }

        let opened = false;
        const ws = new WebSocket(
            `${WS_BACKEND_URL}?token=${encodeURIComponent(token)}`
        );

        ws.onopen = () => {
            opened = true;
            setFailed(false);
            setLoading(false);
            setSocket(ws);
        };

        ws.onerror = (error) => {
            console.error("WebSocket error:", error);
            if (!opened) {
                setFailed(true);
                setLoading(false);
            }
        };

        ws.onclose = () => {
            if (!opened) {
                setFailed(true);
                setLoading(false);
            }
        };

        return () => {
            ws.close();
            setSocket(null);
            setLoading(true);
        };
    }, [token]);

    return { socket, loading, failed };
}
