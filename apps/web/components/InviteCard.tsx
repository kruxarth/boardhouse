"use client";

export function InviteCard({ onCopy, onClose }: { onCopy: () => void; onClose: () => void }) {
    return (
        <aside className="invite-card" aria-label="Invite someone">
            <button aria-label="Close" className="invite-close" onClick={onClose} type="button">
                <svg aria-hidden="true" viewBox="0 0 16 16">
                    <path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" />
                </svg>
            </button>
            <p className="invite-kicker">You have the table to yourself.</p>
            <h2 className="invite-title">Invite someone in</h2>
            <p className="invite-copy">Send this link. It does not include your host key.</p>
            <button className="invite-button" onClick={onCopy} type="button">
                Copy invite link
            </button>
            <button className="invite-solo" onClick={onClose} type="button">
                Draw on my own
            </button>
        </aside>
    );
}
