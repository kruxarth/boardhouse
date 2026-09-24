"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "./landing.module.css";
import { ClaimTable } from "../components/ClaimTable";
import { Facade, MarkerFilters, Roof, TrayMarkers } from "../components/HouseArt";
import { HouseWindow, LoadingWindow } from "../components/HouseWindow";
import { useLocalSession } from "../hooks/useLocalSession";
import { claimRoom, createRoom, fetchOccupancy, sessionForSitting, type Occupancy } from "../lib/api";
import { rememberHostKey, readSession } from "../lib/session";
import { installAudioPrime, primeAudio } from "../lib/sounds";

const TABLES = 10;

function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function Home() {
    const router = useRouter();
    const { session, setSession, ready } = useLocalSession();
    const [occupancy, setOccupancy] = useState<Occupancy | null>(null);
    const [houseDown, setHouseDown] = useState(false);
    const [link, setLink] = useState("");
    const [error, setError] = useState("");
    const [pending, setPending] = useState(false);
    const [claiming, setClaiming] = useState(false);
    const [claimingSlug, setClaimingSlug] = useState<string | null>(null);
    const [wipingSlug, setWipingSlug] = useState<string | null>(null);
    const [settled, setSettled] = useState(false);

    useEffect(() => {
        installAudioPrime();
    }, []);

    // Once the house has drawn itself, pin the strokes so a resize doesn't replay it.
    useEffect(() => {
        const timer = window.setTimeout(() => setSettled(true), 1_600);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const next = await fetchOccupancy();
                if (!cancelled) {
                    setOccupancy(next);
                    setHouseDown(false);
                }
            } catch {
                if (!cancelled) {
                    setHouseDown(true);
                }
            }
        }
        void load();
        const timer = window.setInterval(() => void load(), 8_000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, []);

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
                    selected={offset === claimIndex}
                    table={table}
                    wiping={!table.empty && table.slug === wipingSlug}
                />
            </li>
        );
    }

    const hint = houseFull
        ? "Every table is taken. A table frees up when it's been quiet for 10 minutes."
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
                              : "Counting tables…"}
                    </p>
                </header>

                <main className={styles.stage}>
                    <p className={styles.note}>10 seats a table. 2 markers. Wiped after 24h.</p>
                    {houseDown ? (
                        <div className={styles.locked} role="alert">
                            <p className={styles.lockedTitle}>The house is locked from this site.</p>
                            <p>Check FRONTEND_URL on the HTTP server, then reload.</p>
                        </div>
                    ) : (
                        <div className={styles.house}>
                            <Roof />
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
                        <TrayMarkers />
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
