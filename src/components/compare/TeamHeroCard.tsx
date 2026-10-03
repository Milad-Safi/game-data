"use client";

import { useEffect, useState } from "react";
import { getTeamLogoSrc } from "@/lib/teamAssets";
import { getTeamColor } from "@/lib/teamColours";

type TeamLogoProps = {
    teamAbbrev: string;
    teamLabel: string;
    logoSrc?: string;
};

type TeamHeroCardProps = {
    teamAbbrev: string;
    teamLabel: string;
    align: "left" | "right";
    placeholderLogo?: boolean;
    accentColor?: string;
    logoSrc?: string;
};

function TeamLogo({ teamAbbrev, teamLabel, logoSrc: suppliedLogo }: TeamLogoProps) {
    const logoSrc = suppliedLogo ?? getTeamLogoSrc(teamLabel, teamAbbrev);
    const [imageFailed, setImageFailed] = useState(false);

    useEffect(() => {
        setImageFailed(false);
    }, [logoSrc]);

    return (
        <div className="compareHeroLogoShell">
            {!imageFailed && (
                <img
                    key={logoSrc}
                    src={logoSrc}
                    alt={`${teamLabel} logo`}
                    className="compareHeroLogo"
                    onError={() => setImageFailed(true)}
                />
            )}

            {imageFailed && (
                <span className="compareHeroLogoFallback">{teamAbbrev}</span>
            )}
        </div>
    );
}

export default function TeamHeroCard({
    teamAbbrev,
    teamLabel,
    align,
    placeholderLogo = false,
    accentColor,
    logoSrc,
}: TeamHeroCardProps) {
    const accent = accentColor ?? getTeamColor(teamAbbrev);

    return (
        <div
            className={`compareHeroCard compareHeroCard${
                align === "left" ? "Left" : "Right"
            }`}
        >
            <div
                className={`compareHeroAccent compareHeroAccent${
                    align === "left" ? "Left" : "Right"
                }`}
                style={{ backgroundColor: accent }}
            />

            <div className="compareHeroCardInner">
                {placeholderLogo ? <div className="compareHeroLogoShell"><span className="compareHeroLogoFallback" style={{ display: "grid" }}>{teamAbbrev}</span></div> : <TeamLogo teamAbbrev={teamAbbrev} teamLabel={teamLabel} logoSrc={logoSrc} />}

                <div className="compareHeroContent">
                    <h3 className="compareHeroName">{teamLabel}</h3>
                </div>
            </div>
        </div>
    );
}