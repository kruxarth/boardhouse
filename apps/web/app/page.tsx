"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "./landing.module.css";
import { ClaimTable } from "../components/ClaimTable";
import {
    Facade,
    LeftoverGame,
    MarkerFilters,
    Roof,
    TrayMarkers,
    type TrayMood,
} from "../components/HouseArt";
import { HouseWindow, LoadingWindow } from "../components/HouseWindow";
import { useLocalSession } from "../hooks/useLocalSession";
import { claimRoom, createRoom, fetchOccupancy, sessionForSitting, type Occupancy } from "../lib/api";
import { rememberHostKey, readSession } from "../lib/session";
import { installAudioPrime, primeAudio } from "../lib/sounds";
import { elapsedLabel, nudgeTableLine, SLOW_MS, WAKE_BUDGET_MS } from "../lib/wake";

const TABLES = 10;

function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function Home() {
    const router = useRouter();
    const { session, setSession, ready } = useLocalSession();
    const [occupancy, setOccupancy] = useState<Occupancy | null>(null);
    const [houseDown, setHouseDown] = useState(false);
    const [wakeSince, setWakeSince] = useState(0);
    const [now, setNow] = useState(0);
    const [link, setLink] = useState("");
    const [error, setError] = useState("");
    const [pending, setPending] = useState(false);
    const [claiming, setClaiming] = useState(false);
    const [claimingSlug, setClaimingSlug] = useState<string | null>(null);
    const [wipingSlug, setWipingSlug] = useState<string | null>(null);
    const [settled, setSettled] = useState(false);
    const [mood, setMood] = useState<TrayMood>(null);

    useEffect(() => {
        installAudioPrime();
    }, []);

    // Once the house has drawn itself, pin the strokes so a resize doesn't replay it.
    useEffect(() => {
        const timer = window.setTimeout(() => setSettled(true), 1_600);
        return () => window.clearTimeout(timer);
    }, []);

    // A cold start fails requests for a while; only call the house down once waking has run out of time.
    useEffect(() => {
        let cancelled = false;
        let timer: number | undefined;
        let failingSince = 0;
        async function load() {
            const started = Date.now();
            const slow = window.setTimeout(() => {
                if (!cancelled) {
                    failingSince ||= started;
                    setWakeSince(failingSince);
                }
            }, SLOW_MS);
            try {
                const next = await fetchOccupancy();
                window.clearTimeout(slow);
                if (cancelled) {
                    return;
                }
                failingSince = 0;
                setOccupancy(next);
                setHouseDown(false);
                setWakeSince(0);
                timer = window.setTimeout(() => void load(), 8_000);
            } catch {
                window.clearTimeout(slow);
                if (cancelled) {
                    return;
                }
                failingSince ||= started;
                const down = Date.now() - failingSince > WAKE_BUDGET_MS;
                setHouseDown(down);
                setWakeSince(down ? 0 : failingSince);
                timer = window.setTimeout(() => void load(), down ? 15_000 : 3_000);
            }
        }
        nudgeTableLine();
        void load();
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, []);

    useEffect(() => {
        if (!wakeSince) {
            return;
        }
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, [wakeSince]);

    const tables = occupancy?.tables ?? null;
    const quietOpen = tables?.some((table) => !table.empty && table.unused) ?? false;
    const houseFull = occupancy !== null && occupancy.used >= occupancy.max && !quietOpen;
    const firstEmpty = tables?.findIndex((table) => table.empty) ?? -1;
    const claimIndex = claiming
        ? claimingSlug
            ? (tables?.findIndex((table) => !table.empty && table.slug === claimingSlug) ?? -1)
            : firstEmpty
        : -1;
    const walk = link.trim().length > 0;
    const someoneSeated = tables?.some((table) => !table.empty && table.seated > 0) ?? false;
    const sitDisabled = pending || !ready || houseFull || firstEmpty < 0;

    async function openTable(payload: { name?: string; tableName: string }) {
        primeAudio();
        setError("");
        setPending(true);
        try {
            const nextSession = await sessionForSitting(readSession(), payload.name);
            setSession(nextSession);
            const wiped = claimingSlug;
            const room = wiped
                ? await claimRoom(nextSession.token, wiped, payload.tableName)
                : await createRoom(nextSession.token, payload.tableName);
            rememberHostKey(room.slug, room.hostKey);
            if (wiped && !reducedMotion()) {
                setWipingSlug(wiped);
                await new Promise((resolve) => window.setTimeout(resolve, 520));
            }
            router.push(room.hostPath);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Could not open a table";
            if (message === "Name required") {
                setSession(null);
                setError("Tell us what to call you first.");
            } else {
                setError(message);
                setClaiming(false);
                setClaimingSlug(null);
            }
            if (message === "House is full" || message === "That table is no longer unused") {
                const next = await fetchOccupancy().catch(() => null);
                if (next) {
                    setOccupancy(next);
                }
            }
        } finally {
            setPending(false);
        }
    }

    function beginClaim(slug?: string) {
        primeAudio();
        if (pending || (!slug && houseFull)) {
            return;
        }
        if (!readSession() && session) {
            setSession(null);
        }
        setClaimingSlug(slug ?? null);
        setClaiming(true);
        setError("");
    }

    function cancelClaim() {
        setClaiming(false);
        setClaimingSlug(null);
        setError("");
    }

    function openLink(event: FormEvent) {
        event.preventDefault();
        primeAudio();
        const trimmed = link.trim();
        if (!trimmed) {
            beginClaim();
            return;
        }
        try {
            const url = trimmed.includes("://")
                ? new URL(trimmed)
                : new URL(trimmed, window.location.origin);
            const parts = url.pathname.split("/").filter(Boolean);
            const roomIndex = parts.indexOf("room");
            const slug = roomIndex >= 0 ? parts[roomIndex + 1] : parts[0];
            if (!slug) {
                setError("That isn't a table link. It should look like /room/quiet-otter.");
                return;
            }
            const host = url.searchParams.get("host");
            router.push(host ? `/room/${slug}?host=${host}` : `/room/${slug}`);
        } catch {
            router.push(`/room/${trimmed}`);
        }
    }

    function renderWindow(offset: number) {
        const index = offset + 1;
        const table = tables?.[offset];
        if (!table) {
            return (
                <li key={`wait-${index}`}>
                    <LoadingWindow index={index} />
                </li>
            );
        }
        return (
            <li key={table.empty ? `empty-${index}` : table.slug}>
                <HouseWindow
                    disabled={pending || !ready}
                    index={index}
                    onEmpty={() => beginClaim()}
                    onOccupied={(slug) => router.push(`/room/${slug}?knock=1`)}
                    onUnused={(slug) => beginClaim(slug)}
                    onMood={setMood}
                    selected={offset === claimIndex}
                    table={table}
                    wiping={!table.empty && table.slug === wipingSlug}
                />
            </li>
        );
    }

    const hint = wakeSince
        ? `The house naps when nobody's around. Waking it up can take a minute or two. Waiting ${elapsedLabel(now - wakeSince)}.`
        : houseFull
          ? "Every table is taken. A table frees up when it's been quiet for an hour."
          : "Knock on a pink table to join it, or sit at an empty one to host.";

    return (
        <div className={settled ? `${styles.page} ${styles.settled}` : styles.page}>
            <MarkerFilters />
            <div className={styles.board}>
                <header className={styles.header}>
                    <div>
                        <h1 className={styles.wordmark}>board-house</h1>
                        <p className={styles.tagline}>Draw together for a day. Then it&apos;s wiped.</p>
                    </div>
                    <p className={styles.count} aria-live="polite">
                        {occupancy
                            ? `${occupancy.used} of ${occupancy.max} tables in use`
                            : houseDown
                              ? "House unreachable"
                              : wakeSince
                                ? "Waking up the house…"
                                : "Counting tables…"}
                    </p>
                </header>

                <main className={styles.stage}>
                    <p className={styles.note}>10 seats a table. 2 markers. Wiped after 24h.</p>
                    <LeftoverGame />
                    {houseDown ? (
                        <div className={styles.locked} role="alert">
                            <p className={styles.lockedTitle}>The house isn&apos;t answering.</p>
                            <p>
                                It may still be waking up. If this lasts, check that the HTTP server is running and
                                that FRONTEND_URL on it includes this site, then reload.
                            </p>
                        </div>
                    ) : (
                        <div className={styles.house}>
                            <Roof hearth={someoneSeated ? "smoke" : "asleep"} />
                            <div className={styles.walls}>
                                <Facade />
                                <ol aria-label="Tables" className={styles.grid}>
                                    {Array.from({ length: TABLES }, (_, offset) => renderWindow(offset))}
                                </ol>
                            </div>
                        </div>
                    )}
                </main>

                <footer className={claiming ? `${styles.tray} ${styles.trayOpen}` : styles.tray}>
                    {ready && claiming ? (
                        <div className={styles.trayPanel}>
                            <ClaimTable
                                needName={!session}
                                onCancel={cancelClaim}
                                onSubmit={(payload) => void openTable(payload)}
                                pending={pending}
                                tableNumber={claimIndex >= 0 ? claimIndex + 1 : null}
                                unused={Boolean(claimingSlug)}
                            />
                        </div>
                    ) : null}
                    <div className={styles.ledge}>
                        <TrayMarkers mood={claiming ? "hold" : mood} />
                        <p
                            className={error ? `${styles.message} ${styles.error}` : styles.message}
                            role={error ? "alert" : undefined}
                        >
                            {error || hint}
                        </p>
                        {claiming ? null : (
                            <form className={styles.linkForm} onSubmit={openLink}>
                                <input
                                    aria-label="Paste a table link"
                                    autoCapitalize="off"
                                    autoCorrect="off"
                                    className={styles.input}
                                    onChange={(event) => setLink(event.target.value)}
                                    placeholder="Paste a table link"
                                    spellCheck={false}
                                    value={link}
                                />
                                <button
                                    className={styles.primary}
                                    disabled={!walk && sitDisabled}
                                    onBlur={() => setMood(null)}
                                    onFocus={() => setMood(walk ? "knock" : "sit")}
                                    onPointerEnter={() => setMood(walk ? "knock" : "sit")}
                                    onPointerLeave={() => setMood(null)}
                                    type="submit"
                                >
                                    {walk ? "Walk in" : "Sit down"}
                                </button>
                            </form>
                        )}
                    </div>
                </footer>
            </div>
        </div>
    );
}
