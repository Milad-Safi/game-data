"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { SITE_HEADER_LINKS } from "@/lib/siteNav";

type SiteChromeProps = {
    children: ReactNode;
};

export default function SiteChrome({ children }: SiteChromeProps) {
    const pathname = usePathname();
    const isNFL = pathname === "/nfl" || pathname.startsWith("/nfl/");
    const isHome = pathname === "/" || pathname === "/nfl";

    return (
        <>
            <SiteHeader isHome={isHome} navLinks={isNFL ? [{ label: "Compare", href: "/nfl/compare" }] : SITE_HEADER_LINKS} />
            {children}
            <SiteFooter />
        </>
    );
}