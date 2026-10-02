"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function HomePage() {
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
        <main className="homePage">
            <section className="heroSection">
                <div className="heroStack">
                    <div className="heroCopy" data-reveal>
                        <p className="sectionLabel">Game Data · NHL analytics</p>

                        <h1 className="heroTitle">Go beyond the box score</h1>

                        <p className="heroText">
                            Team comparisons, forecasts, game breakdowns, and
                            league-wide visuals built to make NHL data easier to
                            read.
                        </p>

                        <div className="heroActions">
                            <button
                                type="button"
                                className="primaryButton"
                                onClick={handleExploreFeaturesClick}
                            >
                                Explore features
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            <section id="features-container" className="featuresBlackout">
                <div className="featuresContent">
                    <div className="featuresIntro" data-reveal>
                        <h2 className="featuresIntroTitle">
                            Explore the platform
                        </h2>

                        <p className="featuresIntroText">
                            Each page focuses on a different part of the game,
                            from team comparisons to game breakdowns, league
                            metrics and team trends.
                        </p>
                    </div>

                    <div className="bentoGrid" data-reveal>
                        <div className="bentoCard">
                            <div className="cardBody">
                                <span className="cardTag">Matchups</span>
                                <h3 className="cardTitle">Compare Teams</h3>
                                <p className="cardText">
                                    Put any two teams side-by-side and see
                                    exactly how they stack up across the board
                                </p>

                                <Link href="/compare" className="cardButton">
                                    View Matchups
                                </Link>
                            </div>
                        </div>

                        <div className="bentoCard">
                            <div className="cardBody">
                                <span className="cardTag">Previous Games</span>
                                <h3 className="cardTitle">Past Boxscores</h3>
                                <p className="cardText">
                                    Browse past games and search previous games
                                    since 2023 and view detailed boxscores for
                                    each game, including player stats and shot maps
                                </p>

                                <Link href="/games" className="cardButton">
                                    Open Boxscores
                                </Link>
                            </div>
                        </div>

                        <div className="bentoCard">
                            <div className="cardBody">
                                <span className="cardTag">League Metrics</span>
                                <h3 className="cardTitle">Teams Visualized</h3>
                                <p className="cardText">
                                    Build custom visualizations. Plot any two
                                    metrics to see exactly where every team
                                    stands
                                </p>

                                <Link href="/visualizer" className="cardButton">
                                    View Visuals
                                </Link>
                            </div>
                        </div>


                        <div className="bentoCard">
                            <div className="cardBody">
                                <span className="cardTag">Model</span>
                                <h3 className="cardTitle">Team Trends</h3>
                                <p className="cardText">
                                    Get AI-powered predictions on teams short-term direction
                                </p>

                                <Link href="/trends" className="cardButton">
                                    View Forecasts
                                </Link>
                            </div>
                        </div>

                    </div>
                </div>
            </section>
        </main>
    );
}