/** A marker is identified by the mark it makes, not by a picture of a pen. */
export function InkStroke({ ink }: { ink: string }) {
    return (
        <svg aria-hidden="true" viewBox="0 0 30 16" className="ink-stroke">
            <path
                d="M3 11.2c3.3-6.1 6.2-7.6 8.8-4.7 2.5 2.8 5.2 3.6 8.2.6 1.9-1.9 3.6-2 5-.4"
                fill="none"
                stroke={ink}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

export function MicIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="glyph">
            <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
            <path
                d="M7 11.5a5 5 0 0 0 10 0"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
            />
            <path d="M12 16.5v3.8M9 21h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
        </svg>
    );
}

export function MicOffIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="glyph">
            <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
            <path
                d="M7 11.5a5 5 0 0 0 10 0"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
            />
            <path d="M12 16.5v3.8M9 21h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
            <path d="M5 5.5 19 19" stroke="currentColor" strokeWidth="2" />
        </svg>
    );
}

export function FileIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="glyph">
            <path d="M7 4.5h7.2L18 8.4V19.5H7Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M14 4.5v4.2h4" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
}

export function DownloadIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="glyph">
            <path d="M12 3v12" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="m7.5 11.5 4.5 5 4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M5 19.5h14" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
}

export function PlayIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="glyph">
            <path d="M8 5.5v13l11-6.5Z" fill="currentColor" />
        </svg>
    );
}

export function LinkIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="glyph">
            <path
                d="M10 13.5 8.8 14.7a3.2 3.2 0 0 1-4.5-4.5L6.5 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
            />
            <path
                d="M14 10.5 15.2 9.3a3.2 3.2 0 1 1 4.5 4.5L17.5 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
            />
            <path d="M9.5 14.5 14.5 9.5" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
}

export function KeyIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="glyph">
            <circle cx="8.2" cy="12" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M11.4 12h8.2v2.4M16.2 12v2.6M18.6 12v2.6" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
}

export function DoorIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="glyph">
            <path d="M6 20V5.5h9.5L18 8.2V20Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M15.2 11.6h.1" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
    );
}

export function RotateIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="glyph">
            <path
                d="M19 11a7 7 0 1 1-2.1-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
            />
            <path d="M19 4.5v5.2h-5.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
}

export function WipeIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="glyph">
            <path d="M5 7h14M9 7V5.4h6V7M8 7l.8 12.2h6.4L16 7" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
}

export function DrawerIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="glyph">
            <path d="M5 6h14M5 12h14M5 18h14" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
}

export function CloseIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="glyph">
            <path d="M6 6 18 18M18 6 6 18" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
}

export function AskIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="glyph">
            <path d="M8.2 20.5V11l3.2-5.2a1.6 1.6 0 0 1 3 .9V11h4.1a1.7 1.7 0 0 1 1.6 2.2l-1.6 6.2a2 2 0 0 1-1.9 1.5H8.2Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8.2 11H6.4a1.4 1.4 0 0 0-1.4 1.4v6.6A1.4 1.4 0 0 0 6.4 20.5h1.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
    );
}

export function PutDownIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="glyph">
            <path d="M7 4.8h10v7.4H7Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 12.2v7M9 16.4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
}

export function SmileIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="glyph">
            <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8.6 14.2a4.2 4.2 0 0 0 6.8 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M9.4 9.6h.1M14.5 9.6h.1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
    );
}

export function GrabIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="glyph">
            <path d="M8 13.2V8.4a1.2 1.2 0 0 1 2.4 0v3.2M10.4 11.2V7.6a1.2 1.2 0 1 1 2.4 0v3.6M12.8 10.8V8a1.2 1.2 0 1 1 2.4 0v5.4c0 2.4-1.6 4.4-3.8 5.2-2.4.8-5-.6-5.6-3L7 13.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
    );
}
