"use client";

import Link from "next/link";
import { MouseEvent, useCallback, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
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
    const router = useRouter();
    const isNFL = pathname === "/nfl" || pathname.startsWith("/nfl/");

    const leftLinks = useMemo(() => navLinks.slice(0, 2), [navLinks]);
    const rightLinks = useMemo(() => navLinks.slice(2), [navLinks]);

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
            <div className="siteHeaderInner">
                {/* Left Group */}
                <nav className="siteNav" aria-label="Primary Left">
                    <label className="siteSportSelector">
                        <span className="siteSportLabel">Sport</span>
                        <select aria-label="Select sport" value={isNFL ? "NFL" : "NHL"} onChange={(event) => router.push(event.target.value === "NFL" ? "/nfl" : "/")}>
                            <option value="NHL">NHL</option>
                            <option value="NFL">NFL</option>
                        </select>
                    </label>
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
