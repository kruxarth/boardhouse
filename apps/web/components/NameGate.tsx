"use client";

import { useState } from "react";

export function NameGate({
    title,
    submitLabel,
    onSubmit,
    extra,
    pending,
}: {
    title: string;
    submitLabel: string;
    onSubmit: (name: string) => void;
    extra?: React.ReactNode;
    pending?: boolean;
}) {
    const [name, setName] = useState("");

    return (
        <form
            className="door-form"
            onSubmit={(event) => {
                event.preventDefault();
                const trimmed = name.trim();
                if (trimmed.length < 2) {
                    return;
                }
                onSubmit(trimmed);
            }}
        >
            <p className="door-kicker">{title}</p>
            <input
                autoFocus
                className="field"
                maxLength={24}
                minLength={2}
                name="display-name"
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name at the table"
                value={name}
            />
            {extra}
            <button className="btn btn-brass" disabled={pending} type="submit">
                {submitLabel}
            </button>
        </form>
    );
}
