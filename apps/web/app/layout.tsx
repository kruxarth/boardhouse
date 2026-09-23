import type { Metadata } from "next";
import localFont from "next/font/local";
import { Figtree, Fraunces, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
    subsets: ["latin"],
    variable: "--font-fraunces",
});

const figtree = Figtree({
    subsets: ["latin"],
    variable: "--font-figtree",
});

const grotesk = Schibsted_Grotesk({
    subsets: ["latin"],
    variable: "--font-grotesk",
    weight: ["400", "500", "700"],
});

const excalifont = localFont({
    src: "./fonts/Excalifont-Regular.woff2",
    variable: "--font-hand",
    weight: "400",
    display: "swap",
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
            <body
                className={`${fraunces.variable} ${figtree.variable} ${grotesk.variable} ${excalifont.variable}`}
            >
                {children}
            </body>
        </html>
    );
}
