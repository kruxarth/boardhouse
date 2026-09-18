"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RoofArt, SkyArt } from "../components/HouseArt";
import { HouseWindow } from "../components/HouseWindow";
import { NameGate } from "../components/NameGate";
import { useLocalSession } from "../hooks/useLocalSession";
import { createRoom, fetchOccupancy, sessionForSitting, type Occupancy } from "../lib/api";
import { rememberHostKey, readSession } from "../lib/session";

export default function Home() {
    const router = useRouter();
    const { session, setSession, ready } = useLocalSession();
    const [occupancy, setOccupancy] = useState<Occupancy | null>(null);
    const [houseDown, setHouseDown] = useState(false);
    const [label, setLabel] = useState("");
    const [link, setLink] = useState("");
    const [error, setError] = useState("");
    const [pending, setPending] = useState(false);
    const [claiming, setClaiming] = useState(false);

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

    const houseFull = occupancy !== null && occupancy.used >= occupancy.max;
    const tables = occupancy?.tables ?? null;

    async function openTable(name?: string) {
        setError("");
        setPending(true);
        try {
            const nextSession = await sessionForSitting(readSession(), name);
            setSession(nextSession);
            const room = await createRoom(nextSession.token, label.trim() || undefined);
            rememberHostKey(room.slug, room.hostKey);
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
            }
            if (message === "House is full") {
                const next = await fetchOccupancy().catch(() => occupancy);
                if (next) {
                    setOccupancy(next);
                }
            }
        } finally {
            setPending(false);
        }
    }

    function onEmptyTable() {
        if (houseFull || pending) {
            return;
        }
        if (!readSession()) {
            if (session) {
                setSession(null);
            }
            setClaiming(true);
            return;
        }
        void openTable();
    }

    function openLink(event: React.FormEvent) {
        event.preventDefault();
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

    function renderFloor(from: number, to: number) {
        return (
            <ol className="floor">
                {tables
                    ? tables.slice(from, to).map((table, offset) => {
                          const index = from + offset + 1;
                          return (
                              <li key={table.empty ? `empty-${index}` : table.slug}>
                                  <HouseWindow
                                      index={index}
                                      table={table}
                                      disabled={pending || !ready}
                                      onEmpty={onEmptyTable}
                                      onOccupied={(slug) => router.push(`/room/${slug}?knock=1`)}
                                  />
                              </li>
                          );
                      })
                    : Array.from({ length: to - from }, (_, offset) => (
                          <li key={`wait-${from + offset}`}>
                              <div className="window window-dark window-wait" />
                          </li>
                      ))}
            </ol>
        );
    }

    return (
        <div className="house">
            <header className="house-lintel">
                <div>
                    <h1 className="house-sign">board-house</h1>
                    <p className="lede">Ten tables. Closed doors. One day.</p>
                </div>
                <p className="plate">{occupancy ? `${occupancy.used} / ${occupancy.max}` : "— / 10"}</p>
            </header>

            {error ? <p className="error">{error}</p> : null}

            <main className="scene">
                <SkyArt />
                <div className="dwelling">
                    <RoofArt />
                    <div className="facade">
                        {renderFloor(0, 4)}
                        {renderFloor(4, 8)}
                        <div className="ground">
                            <ol className="floor floor-ground">
                                {tables
                                    ? tables.slice(8, 10).map((table, offset) => {
                                          const index = 8 + offset + 1;
                                          return (
                                              <li key={table.empty ? `empty-${index}` : table.slug}>
                                                  <HouseWindow
                                                      index={index}
                                                      table={table}
                                                      disabled={pending || !ready}
                                                      onEmpty={onEmptyTable}
                                                      onOccupied={(slug) => router.push(`/room/${slug}?knock=1`)}
                                                  />
                                              </li>
                                          );
                                      })
                                    : Array.from({ length: 2 }, (_, offset) => (
                                          <li key={`wait-${8 + offset}`}>
                                              <div className="window window-dark window-wait" />
                                          </li>
                                      ))}
                            </ol>
                            <div className="frontdoor">
                                <div className="frontdoor-arch">
                                    <span className="knob" aria-hidden="true" />
                                    {ready && claiming && !session ? (
                                        <>
                                            <NameGate
                                                title="What should we call you?"
                                                submitLabel="Sit down"
                                                pending={pending}
                                                onSubmit={(name) => void openTable(name)}
                                            />
                                            <button
                                                className="btn btn-ghost"
                                                onClick={() => setClaiming(false)}
                                                type="button"
                                            >
                                                Cancel
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <p className="frontdoor-kicker">The front door</p>
                                            {houseFull ? (
                                                <p className="vacancy-tag">Full house</p>
                                            ) : null}
                                            <form className="frontdoor-form" onSubmit={openLink}>
                                                <input
                                                    className="field"
                                                    onChange={(event) => setLink(event.target.value)}
                                                    placeholder="Paste a table link"
                                                    value={link}
                                                />
                                                <button className="btn btn-ghost" type="submit">
                                                    Walk in
                                                </button>
                                            </form>
                                            {ready && session && !houseFull ? (
                                                <div className="frontdoor-claim">
                                                    <input
                                                        className="field"
                                                        maxLength={40}
                                                        onChange={(event) => setLabel(event.target.value)}
                                                        placeholder="Name this table, if you want"
                                                        value={label}
                                                    />
                                                    <p className="frontdoor-hint">
                                                        Then pick a dark window.
                                                    </p>
                                                </div>
                                            ) : null}
                                            {!session && !houseFull ? (
                                                <p className="frontdoor-hint">
                                                    No key? Pick a dark window and sit down.
                                                </p>
                                            ) : null}
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="street" aria-hidden="true" />
                </div>
                {tables ? null : (
                    <p className="scene-wait" role="status">
                        {houseDown
                            ? "The house is locked from this site. Check FRONTEND_URL on HTTP, then reload."
                            : "The house is waking up."}
                    </p>
                )}
            </main>

            <footer>
                <ul className="house-rules">
                    <li>Ten seats at a table. No spectators.</li>
                    <li>Two markers move. Everyone else points.</li>
                    <li>Mics work like a call. The host can mute you; only you unmute yourself.</li>
                    <li>Every table is wiped at twenty-four hours. Take the replay with you.</li>
                </ul>
            </footer>
        </div>
    );
}
