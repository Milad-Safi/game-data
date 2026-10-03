"use client";

import Link from "next/link";
import { useEffect, type CSSProperties } from "react";

export default function HomePage({ sport = "NHL" }: { sport?: "NHL" | "NFL" }) {
    const isNFL = sport === "NFL";
    useEffect(() => {
        const revealNodes = Array.from(
            document.querySelectorAll<HTMLElement>("[data-reveal]")
        );

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add("isVisible");
                    }
                });
            },
            {
                threshold: 0.22,
                rootMargin: "0px 0px -14% 0px",
            }
        );

        revealNodes.forEach((node) => observer.observe(node));
        return () => observer.disconnect();
    }, []);

    const handleExploreFeaturesClick = () => {
        const featuresIntro =
            document.querySelector<HTMLElement>(".featuresIntro");
        if (!featuresIntro) return;

        const headerHeight =
            document.querySelector<HTMLElement>(".siteHeader")?.offsetHeight ?? 0;

        const targetTop =
            featuresIntro.getBoundingClientRect().top +
            window.scrollY -
            headerHeight -
            18;

        window.scrollTo({
            top: Math.max(targetTop, 0),
            behavior: "smooth",
        });
    };

    return (
        <main className="homePage" style={isNFL ? { "--home-hero-image": 'url("/nfl.jpeg")' } as CSSProperties : undefined}>
            <section className="heroSection">
                <div className="heroStack">
                    <div className="heroCopy" data-reveal>
                        <p className="sectionLabel">{isNFL ? "Game Data · NFL" : "Game Data · Sports analytics"}</p>

                        <h1 className="heroTitle">Go beyond the box score</h1>

                        <p className="heroText">
                            {isNFL ? "A new home for NFL data. Explore the game beyond the box score as Game Data expands to football." : <>Understand the game through team comparisons, performance
                            trends, and clear visuals that turn sports data into
                            a deeper view of every matchup.</>}
                        </p>

                        <div className="heroActions">
                            <button
                                type="button"
                                className="primaryButton"
                                onClick={handleExploreFeaturesClick}
                            >
                                {isNFL ? "Explore NFL" : "Explore features"}
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            <section id="features-container" className="featuresBlackout">
                <div className="featuresContent">
                    <div className="featuresIntro" data-reveal>
                        <h2 className="featuresIntroTitle">
                            {isNFL ? "NFL on Game Data" : "Explore the platform"}
                        </h2>

                        <p className="featuresIntroText">
                            {isNFL ? "Explore the NFL team comparison preview. Live football statistics are not connected yet." : <>Each page focuses on a different part of the game,
                            from team comparisons to game breakdowns, league
                            metrics and team trends.</>}
                        </p>
                    </div>

                    {isNFL && <div className="bentoGrid" data-reveal>
                        <Link href="/nfl/compare" className="bentoCard"><div className="cardBody">
                            <span className="cardTag">NFL · UI preview</span><h3 className="cardTitle">Compare Teams</h3>
                            <p className="cardText">Select two NFL teams and preview the comparison layout with placeholder statistics.</p>
                        </div></Link>
                    </div>}
                    {!isNFL && <div className="bentoGrid" data-reveal>
                        <Link href="/compare" className="bentoCard">
                            <div className="cardBody">
                                <span className="cardTag">Matchups</span>
                                <h3 className="cardTitle">Compare Teams</h3>
                                <p className="cardText">
                                    Put any two teams side-by-side and see
                                    exactly how they stack up across the board
                                </p>
                            </div>
                        </Link>

                        <Link href="/games" className="bentoCard">
                            <div className="cardBody">
                                <span className="cardTag">Previous Games</span>
                                <h3 className="cardTitle">Past Boxscores</h3>
                                <p className="cardText">
                                    Browse past games and search previous games
                                    since 2023 and view detailed boxscores for
                                    each game, including player stats and shot maps
                                </p>
                            </div>
                        </Link>

                        <Link href="/simulator" className="bentoCard">
                            <div className="cardBody">
                                <span className="cardTag">Season Projections</span>
                                <h3 className="cardTitle">Season Simulator</h3>
                                <p className="cardText">
                                    Explore projected final points and playoff
                                    probabilities from 10,000 simulated NHL seasons.
                                </p>
                            </div>
                        </Link>


                        <Link href="/trends" className="bentoCard">
                            <div className="cardBody">
                                <span className="cardTag">Model</span>
                                <h3 className="cardTitle">Team Trends</h3>
                                <p className="cardText">
                                    Get AI-powered predictions on teams short-term direction
                                </p>
                            </div>
                        </Link>

                    </div>}
                </div>
            </section>
        </main>
    );
}