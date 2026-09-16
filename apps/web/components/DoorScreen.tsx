"use client";

export function DoorScreen({
    title,
    body,
    children,
}: {
    title: string;
    body: string;
    children?: React.ReactNode;
}) {
    return (
        <div className="door-page">
            <div className="door">
                <div className="door-panel">
                    <h1 className="door-sign">{title}</h1>
                    <p className="lede">{body}</p>
                    {children}
                </div>
                <span className="knob" aria-hidden="true" />
            </div>
        </div>
    );
}
