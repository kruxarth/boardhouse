"use client";

import { useState } from "react";
import styles from "../app/landing.module.css";

export function ClaimTable({
    needName,
    pending,
    unused,
    tableNumber,
    onSubmit,
    onCancel,
}: {
    needName: boolean;
    pending?: boolean;
    unused?: boolean;
    tableNumber: number | null;
    onSubmit: (payload: { name?: string; tableName: string }) => void;
    onCancel: () => void;
}) {
    const [name, setName] = useState("");
    const [tableName, setTableName] = useState("");
    const ready = tableName.trim().length > 0 && (!needName || name.trim().length >= 2);

    return (
        <form
            className={styles.claim}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    onCancel();
                }
            }}
            onSubmit={(event) => {
                event.preventDefault();
                if (!ready) {
                    return;
                }
                const sitting = tableName.trim();
                onSubmit(needName ? { name: name.trim(), tableName: sitting } : { tableName: sitting });
            }}
        >
            <p className={styles.claimHead}>
                {unused ? "Claim" : "Sit at"} {tableNumber ? `table ${tableNumber}` : "a table"}
                {unused ? <span className={styles.claimWarn}>This wipes the old board for good.</span> : null}
            </p>
            <div className={styles.fields}>
                <label className={styles.field}>
                    <span>Name this table</span>
                    <input
                        autoFocus
                        className={styles.input}
                        maxLength={40}
                        name="table-name"
                        onChange={(event) => setTableName(event.target.value)}
                        placeholder="Sprint plan"
                        value={tableName}
                    />
                </label>
                {needName ? (
                    <label className={styles.field}>
                        <span>Your name</span>
                        <input
                            className={styles.input}
                            maxLength={24}
                            minLength={2}
                            name="display-name"
                            onChange={(event) => setName(event.target.value)}
                            placeholder="At least 2 letters"
                            value={name}
                        />
                    </label>
                ) : null}
            </div>
            <div className={styles.actions}>
                <button className={styles.primary} disabled={pending || !ready} type="submit">
                    {pending ? "Opening…" : unused ? "Claim and wipe" : "Sit down"}
                </button>
                <button className={styles.secondary} disabled={pending} onClick={onCancel} type="button">
                    Cancel
                </button>
            </div>
        </form>
    );
}
