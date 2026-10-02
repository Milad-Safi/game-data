export type SiteHeaderLink = {
    label: string;
    href: string;
};

export const SITE_HEADER_LINKS: SiteHeaderLink[] = [
    { label: "Compare", href: "/compare" },
    { label: "Trends", href: "/trends" },
    { label: "Visualizer", href: "/visualizer" },
    { label: "Games", href: "/games" },
];