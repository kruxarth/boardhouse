"use client";

import { useState } from "react";
import styles from "../app/landing.module.css";
import { isUnauthorizedError, renameSession } from "../lib/api";
import { clearSession, type Session } from "../lib/session";

/** "Drawing as Priya · change": the one name you carry into every table. */
export function WhoAmI({
    session,
    onSession,
}: {
    session: Session;
    onSession: (session: Session | null) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(session.name);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");

    if (!editing) {
        return (
            <p className={styles.whoami}>
                Drawing as <span className={styles.whoamiName}>{session.name}</span>
                <button
                    className={styles.whoamiChange}
                    onClick={() => {
                        setDraft(session.name);
                        setError("");
                        setEditing(true);
                    }}
                    type="button"
                >
                    change
                </button>
            </p>
        );
    }

    return (
        <form
            className={styles.whoamiForm}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    setEditing(false);
                }
            }}
            onSubmit={async (event) => {
                event.preventDefault();
                const next = draft.trim();
                if (next === session.name) {
                    setEditing(false);
                    return;
                }
                if (next.length < 2) {
                    setError("At least 2 letters");
                    return;
                }
                setPending(true);
                setError("");
                try {
                    onSession(await renameSession(session.token, next));
                    setEditing(false);
                } catch (err) {
                    if (isUnauthorizedError(err)) {
                        clearSession();
                        onSession(null);
                        return;
                    }
                    setError(err instanceof Error ? err.message : "Could not change your name");
                } finally {
                    setPending(false);
                }
            }}
        >
            <label className={styles.whoamiLabel}>
                <span>Your name</span>
                <input
                    autoFocus
                    className={styles.whoamiInput}
                    disabled={pending}
                    maxLength={24}
                    onChange={(event) => setDraft(event.target.value)}
                    value={draft}
                />
            </label>
            <button className={styles.whoamiSave} disabled={pending} type="submit">
                {pending ? "Saving…" : "Save"}
            </button>
            <button className={styles.whoamiChange} onClick={() => setEditing(false)} type="button">
                Cancel
            </button>
            {error ? (
                <p className={styles.whoamiError} role="alert">
                    {error}
                </p>
            ) : null}
        </form>
    );
}
