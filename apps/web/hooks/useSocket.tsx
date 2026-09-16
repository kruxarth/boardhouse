import { useEffect, useState } from "react";
import { WS_BACKEND_URL } from "../app/config";

export function useSocket(token: string | null) {
    const [loading, setLoading] = useState(true);
    const [socket, setSocket] = useState<WebSocket | null>(null);

    useEffect(() => {
        if (!token) {
            setSocket(null);
            setLoading(true);
            return;
        }

        const ws = new WebSocket(
            `${WS_BACKEND_URL}?token=${encodeURIComponent(token)}`
        );

        ws.onopen = () => {
            setLoading(false);
            setSocket(ws);
        };

        ws.onerror = (error) => {
            console.error("WebSocket error:", error);
        };

        return () => {
            ws.close();
            setSocket(null);
            setLoading(true);
        };
    }, [token]);

    return { socket, loading };
}
