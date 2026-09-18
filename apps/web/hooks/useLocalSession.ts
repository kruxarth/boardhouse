import { useEffect, useState } from "react";
import { readSession, type Session } from "../lib/session";

export function useLocalSession() {
    const [session, setSession] = useState<Session | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        function sync() {
            const next = readSession();
            setSession((current) =>
                current?.token === next?.token &&
                current?.participantId === next?.participantId &&
                current?.name === next?.name
                    ? current
                    : next
            );
            setReady(true);
        }
        sync();
        window.addEventListener("focus", sync);
        window.addEventListener("storage", sync);
        const timer = window.setInterval(sync, 60_000);
        return () => {
            window.removeEventListener("focus", sync);
            window.removeEventListener("storage", sync);
            window.clearInterval(timer);
        };
    }, []);

    return { session, setSession, ready };
}
