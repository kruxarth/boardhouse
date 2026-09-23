"use client";

import { useEffect, useState } from "react";

export function InviteCard({
    url,
    onCopy,
}: {
    url: string;
    onCopy: () => void;
}) {
    const [svg, setSvg] = useState("");

    useEffect(() => {
        let cancelled = false;
        void import("qrcode")
            .then(async (mod) => {
                const QR = mod.default;
                const markup = await QR.toString(url, {
                    type: "svg",
                    margin: 1,
                    width: 168,
                    color: { dark: "#1D2946", light: "#F3F6F8" },
                });
                if (!cancelled) {
                    setSvg(markup);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setSvg("");
                }
            });
        return () => {
            cancelled = true;
        };
    }, [url]);

    return (
        <aside className="invite-card">
            <p className="invite-kicker">You have the table to yourself.</p>
            <h2 className="invite-title">Invite someone in</h2>
            <p className="invite-copy">Send this link. It does not include your host key.</p>
            {svg ? (
                <div
                    aria-hidden="true"
                    className="invite-qr"
                    dangerouslySetInnerHTML={{ __html: svg }}
                />
            ) : null}
            <button className="btn btn-brass invite-copy" onClick={onCopy} type="button">
                Copy invite link
            </button>
        </aside>
    );
}
