import type { Metadata } from "next";
import "@/styles/global.css";
import { Inter } from "next/font/google";
import React from "react";
import SiteChrome from "@/components/SiteChrome";

const inter = Inter({
    subsets: ["latin"],
    weight: ["400", "500", "600", "700", "800", "900"],
    variable: "--font-inter",
});

export const metadata: Metadata = {
    title: "Game Data",
    description: "A data-driven NHL stats and analytics site, with visualizations and insights to help you understand the game better.",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" data-theme="dark" className={inter.className}>
            <body className="Body">
                <SiteChrome>{children}</SiteChrome>
            </body>
        </html>
    );
}