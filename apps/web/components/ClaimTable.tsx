"use client";

import { useState } from "react";

export function ClaimTable({
    needName,
    pending,
    unused,
    onSubmit,
}: {
    needName: boolean;
    pending?: boolean;
    unused?: boolean;
    onSubmit: (payload: { name?: string; tableName: string }) => void;
}) {
    const [name, setName] = useState("");
    const [tableName, setTableName] = useState("");

    return (
        <form
            className="door-form"
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
            <p className="door-kicker">
                {unused
                    ? "This table went quiet. Name it and it is yours."
                    : "What should we call this table?"}
            </p>
            <input
                autoFocus
                className="field"
                maxLength={40}
                minLength={1}
                name="table-name"
                onChange={(event) => setTableName(event.target.value)}
                placeholder="Name this sitting"
                value={tableName}
            />
            {needName ? (
                <>
                    <p className="door-kicker">What should we call you?</p>
                    <input
                        className="field"
                        maxLength={24}
                        minLength={2}
                        name="display-name"
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Your name at the table"
                        value={name}
                    />
                </>
            ) : null}
            <button className="btn btn-brass" disabled={pending} type="submit">
                {unused ? "Claim this table" : "Sit down"}
            </button>
        </form>
    );
}
