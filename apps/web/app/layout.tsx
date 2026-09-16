import type { Metadata } from "next";
import { Fraunces, Figtree } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
    subsets: ["latin"],
    variable: "--font-fraunces",
});

const figtree = Figtree({
    subsets: ["latin"],
    variable: "--font-figtree",
});

export const metadata: Metadata = {
    title: "board-house",
    description: "Ten tables. Closed doors. One day.",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className={`${fraunces.variable} ${figtree.variable}`}>
                {children}
            </body>
        </html>
    );
}
