import type { Metadata } from "next";
import localFont from "next/font/local";
import { Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const grotesk = Schibsted_Grotesk({
    subsets: ["latin"],
    variable: "--font-grotesk",
});

const excalifont = localFont({
    src: "./fonts/Excalifont-Regular.woff2",
    variable: "--font-hand",
    weight: "400",
    display: "swap",
});

export const metadata: Metadata = {
    title: "board-house",
    description: "Draw together for a day. Then it's wiped.",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className={`${grotesk.variable} ${excalifont.variable}`}>
            <body>{children}</body>
        </html>
    );
}
