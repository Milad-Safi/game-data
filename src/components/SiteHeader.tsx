"use client";

import Link from "next/link";
import { MouseEvent, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import type { SiteHeaderLink } from "@/lib/siteNav";

type SiteHeaderProps = {
    isHome?: boolean;
    navLinks: SiteHeaderLink[];
};

const navLabelMap: Record<string, string> = {
    "/compare": "Compare",
    "/trends": "Trends",
    "/simulator": "SIMULATOR",
    "/games": "Boxscores",
};

export default function SiteHeader({
    isHome = false,
    navLinks,
}: SiteHeaderProps) {
    const pathname = usePathname();
    const isNFL = pathname === "/nfl" || pathname.startsWith("/nfl/");

    const leftLinks = useMemo(() => navLinks.slice(0, isNFL ? 1 : 2), [navLinks, isNFL]);
    const rightLinks = useMemo(() => navLinks.slice(isNFL ? 1 : 2), [navLinks, isNFL]);

    const handleWordmarkClick = useCallback(
        (event: MouseEvent<HTMLAnchorElement>) => {
            if (!isHome) return;
            event.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
            window.history.replaceState(null, "", window.location.pathname);
        },
        [isHome]
    );

    const renderLink = (link: SiteHeaderLink) => {
        const isActive = pathname === link.href;
        const displayLabel = navLabelMap[link.href] ?? link.label;
        return (
            <Link
                key={link.href}
                href={link.href}
                className={`siteNavLink ${isActive ? "siteNavLinkActive" : ""}`}
            >
                {displayLabel}
            </Link>
        );
    };

    return (
        <header className="siteHeader">
                    <details className="siteSportSelector"
                        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
                        onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus({ preventScroll: true }); } }}>
                        <summary aria-label={`Switch sport, current sport ${isNFL ? "NFL" : "NHL"}`}>{isNFL ? "NFL" : "NHL"}<span aria-hidden="true">⌄</span></summary>
                        <div className="siteSportMenu">
                            {[{ name: "NHL", href: "/" }, { name: "NFL", href: "/nfl" }].map(sport =>
                                <Link key={sport.name} href={sport.href} scroll={false}
                                    aria-current={(isNFL ? "NFL" : "NHL") === sport.name ? "true" : undefined}
                                    onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); }}>
                                    {sport.name}
                                </Link>)}
                        </div>
                    </details>

            <div className="siteHeaderInner">
                {/* Left Group */}
                <nav className="siteNav" aria-label="Primary Left">
                    {leftLinks.map(renderLink)}
                </nav>

                {/* Boosted Home Button */}
                <Link
                    href={isNFL ? "/nfl" : "/"}
                    className="siteWordmark"
                    aria-label="Game Data home"
                    title="Game Data — Home"
                    onClick={handleWordmarkClick}
                >
                    HOME
                </Link>

                {/* Right Group */}
                <nav className="siteNav" aria-label="Primary Right">
                    {rightLinks.map(renderLink)}
                </nav>
            </div>
        </header>
    );
}
