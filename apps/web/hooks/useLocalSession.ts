import { useEffect, useState } from "react";
import { readSession, type Session } from "../lib/session";

export function useLocalSession() {
    const [session, setSession] = useState<Session | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        setSession(readSession());
        setReady(true);
    }, []);

    return { session, setSession, ready };
}
