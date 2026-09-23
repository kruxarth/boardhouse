"use client";

import { useState } from "react";

export function ClaimTable({
    needName,
    pending,
    unused,
    onSubmit,
    onCancel,
}: {
    needName: boolean;
    pending?: boolean;
    unused?: boolean;
    onSubmit: (payload: { name?: string; tableName: string }) => void;
    onCancel: () => void;
}) {
    const [name, setName] = useState("");
    const [tableName, setTableName] = useState("");

    return (
        <form
            className="wb-form"
            onSubmit={(event) => {
                event.preventDefault();
                const sitting = tableName.trim();
                const person = name.trim();
                if (sitting.length < 1) {
                    return;
                }
                if (needName && person.length < 2) {
                    return;
                }
                onSubmit(needName ? { name: person, tableName: sitting } : { tableName: sitting });
            }}
        >
            {unused ? (
                <p className="wb-warn">
                    Claiming this table wipes the previous host&apos;s board. Their drawing is deleted.
                </p>
            ) : null}
            <label className="sr-only" htmlFor="table-name">
                Name this table
            </label>
            <input
                autoFocus
                className="wb-input"
                id="table-name"
                maxLength={40}
                minLength={1}
                name="table-name"
                onChange={(event) => setTableName(event.target.value)}
                placeholder="Name this table"
                value={tableName}
            />
            {needName ? (
                <>
                    <label className="sr-only" htmlFor="host-name">
                        Your name
                    </label>
                    <input
                        className="wb-input"
                        id="host-name"
                        maxLength={24}
                        minLength={2}
                        name="display-name"
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Your name"
                        value={name}
                    />
                </>
            ) : null}
            <div className="wb-actions">
                <button className="wb-primary" disabled={pending} type="submit">
                    {unused ? "Claim and wipe" : "Sit down"}
                </button>
                <button className="wb-cancel" onClick={onCancel} type="button">
                    Cancel
                </button>
            </div>
        </form>
    );
}
