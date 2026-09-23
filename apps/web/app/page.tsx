"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ClaimTable } from "../components/ClaimTable";
import {
    DoorSketch,
    GroundSketch,
    MarkerDefs,
    MarkerLedge,
    RoofSketch,
    WallSketch,
    WindowLines,
} from "../components/HouseArt";
import { HouseWindow } from "../components/HouseWindow";
import { useLocalSession } from "../hooks/useLocalSession";
import { claimRoom, createRoom, fetchOccupancy, sessionForSitting, type Occupancy } from "../lib/api";
import { rememberHostKey, readSession } from "../lib/session";
import { installAudioPrime, primeAudio } from "../lib/sounds";

function LinkFields({
    link,
    inputId,
    sitDisabled,
    onLink,
    onSubmit,
    onSit,
}: {
    link: string;
    inputId: string;
    sitDisabled: boolean;
    onLink: (value: string) => void;
    onSubmit: (event: FormEvent) => void;
    onSit: () => void;
}) {
    const walk = link.trim().length > 0;
    return (
        <form className="wb-form" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor={inputId}>
                Paste a table link
            </label>
            <input
                className="wb-input"
                id={inputId}
                onChange={(event) => onLink(event.target.value)}
                placeholder="Paste a table link"
                value={link}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
            />
            <button
                className="wb-primary"
                disabled={!walk && sitDisabled}
                onClick={() => {
                    if (!walk) {
                        onSit();
                    }
                }}
                type={walk ? "submit" : "button"}
            >
                {walk ? "Walk in" : "Sit down"}
            </button>
        </form>
    );
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
    const [ink, setInk] = useState(false);
    const [doorVisible, setDoorVisible] = useState(false);
    const doorRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        installAudioPrime();
    }, []);

    useEffect(() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduce) {
            setInk(true);
            return;
        }
        const wait = Math.max(0, 1120 - performance.now());
        const timer = window.setTimeout(() => setInk(true), wait);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        document.body.classList.add("wb-body");
        return () => document.body.classList.remove("wb-body");
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
                    setOccupancy(null);
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

    useEffect(() => {
        const node = doorRef.current;
        if (!node) {
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (!entry) {
                    return;
                }
                setDoorVisible(entry.isIntersecting && entry.intersectionRatio >= 0.55);
            },
            { threshold: [0, 0.55, 1], rootMargin: "0px 0px -72px 0px" }
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [houseDown, occupancy]);

    const tables = occupancy?.tables ?? null;
    const unusedOpen = tables?.some((table) => !table.empty && table.unused) ?? false;
    const houseFull = occupancy !== null && occupancy.used >= occupancy.max && !unusedOpen;
    const someoneHome = tables?.some((table) => !table.empty && !table.unused) ?? false;
    const firstDark = tables?.findIndex((table) => table.empty) ?? -1;
    const tracedIndex = claiming
        ? claimingSlug
            ? (tables?.findIndex((table) => !table.empty && table.slug === claimingSlug) ?? -1)
            : firstDark
        : -1;
    const sitDisabled = pending || !ready || houseFull || firstDark < 0;

    async function openTable(payload: { name?: string; tableName: string }) {
        primeAudio();
        const sittingName = payload.tableName.trim();
        if (!sittingName) {
            setError("Name this sitting");
            setClaiming(true);
            return;
        }

        setError("");
        setPending(true);
        try {
            const nextSession = await sessionForSitting(readSession(), payload.name);
            setSession(nextSession);
            const wiped = claimingSlug;
            const room = wiped
                ? await claimRoom(nextSession.token, wiped, sittingName)
                : await createRoom(nextSession.token, sittingName);
            rememberHostKey(room.slug, room.hostKey);
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            if (wiped && !reduce) {
                setWipingSlug(wiped);
                await new Promise((resolve) => window.setTimeout(resolve, 520));
            }
            router.push(room.hostPath);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Could not open a table";
            if (message === "Name required") {
                setSession(null);
                setClaiming(true);
                setError("Tell us what to call you");
            } else {
                setError(message);
                setClaiming(false);
                setClaimingSlug(null);
            }
            if (message === "House is full" || message === "That table is no longer unused") {
                const next = await fetchOccupancy().catch(() => occupancy);
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
        if (pending) {
            return;
        }
        if (!slug && houseFull) {
            return;
        }
        if (!readSession() && session) {
            setSession(null);
        }
        setClaimingSlug(slug ?? null);
        setClaiming(true);
        setError("");
        if (window.matchMedia("(max-width: 640px)").matches) {
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            window.requestAnimationFrame(() => {
                doorRef.current?.scrollIntoView({
                    behavior: reduce ? "auto" : "smooth",
                    block: "center",
                });
            });
        }
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
                setError("That is not a table link");
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
                    <div className="wb-win wb-win-wait">
                        <WindowLines faint index={index} />
                    </div>
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
                    table={table}
                    traced={offset === tracedIndex}
                    wiping={!table.empty && table.slug === wipingSlug}
                />
            </li>
        );
    }

    const doorNote = houseFull
        ? "Every table is taken. A window frees up when it's been quiet for 10 minutes."
        : "Pick a dark window to host, or knock on a lit one.";

    return (
        <div className={ink ? "wb wb-ink" : "wb"}>
            <MarkerDefs />
            <div className="wb-board">
                <header className="wb-header">
                    <div className="wb-brand">
                        <h1 className="wb-wordmark">board-house</h1>
                        <p className="wb-tagline">Ten tables. Closed doors. One day.</p>
                        <p className="wb-note">Ten seats. Two markers. Wiped after a day.</p>
                    </div>
                    <p className="wb-count">
                        {occupancy
                            ? `${occupancy.used} of ${occupancy.max} tables in use`
                            : "— of 10 tables in use"}
                    </p>
                </header>

                {houseDown ? (
                    <p className="wb-locked" role="alert">
                        The house is locked from this site. Check FRONTEND_URL on HTTP, then reload.
                    </p>
                ) : (
                    <div className="wb-stage">
                        <div className="wb-house">
                            <RoofSketch home={someoneHome} />
                            <div className={tables ? "wb-facade" : "wb-facade wb-waiting"}>
                                <WallSketch />
                                <ol aria-label="Tables" className="wb-grid">
                                    {Array.from({ length: 10 }, (_, offset) => renderWindow(offset))}
                                    <li className="wb-door-cell">
                                        <div className="wb-door" ref={doorRef}>
                                            <DoorSketch />
                                            <div className="wb-door-panel">
                                                {error ? (
                                                    <p className="wb-error" role="alert">
                                                        {error}
                                                    </p>
                                                ) : null}
                                                {ready && claiming ? (
                                                    <ClaimTable
                                                        needName={!session}
                                                        onCancel={cancelClaim}
                                                        onSubmit={(payload) => void openTable(payload)}
                                                        pending={pending}
                                                        unused={Boolean(claimingSlug)}
                                                    />
                                                ) : (
                                                    <>
                                                        <LinkFields
                                                            inputId="table-link"
                                                            link={link}
                                                            onLink={setLink}
                                                            onSit={() => beginClaim()}
                                                            onSubmit={openLink}
                                                            sitDisabled={sitDisabled}
                                                        />
                                                        <p className="wb-hint">{doorNote}</p>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </li>
                                </ol>
                            </div>
                            <GroundSketch />
                        </div>
                    </div>
                )}
                <MarkerLedge />
            </div>

            {houseDown ? null : (
                <div className={doorVisible ? "wb-doorstep wb-doorstep-hide" : "wb-doorstep"}>
                    {error ? <p className="wb-error">{error}</p> : null}
                    <LinkFields
                        inputId="table-link-step"
                        link={link}
                        onLink={setLink}
                        onSit={() => beginClaim()}
                        onSubmit={openLink}
                        sitDisabled={sitDisabled}
                    />
                </div>
            )}
        </div>
    );
}
