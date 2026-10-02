"use client";

import { useState, type PointerEvent } from "react";

import type { GameDetailChartMode, HistoricalGameShotEvent } from "@/types/games";

type GameEventRinkProps = {
    events: HistoricalGameShotEvent[];
    mode: GameDetailChartMode;
};

function dotClassForEvent(
    event: HistoricalGameShotEvent,
    mode: GameDetailChartMode
) {
    if (event.type === "goal") {
        return mode === "goals"
            ? "historicalGameRinkDot historicalGameRinkDotGoal"
            : "historicalGameRinkDot historicalGameRinkDotShot";
    }

    if (event.type === "blocked-shot") {
        return "historicalGameRinkDot historicalGameRinkDotBlocked";
    }

    if (event.type === "missed-shot") {
        return "historicalGameRinkDot historicalGameRinkDotMissed";
    }

    return "historicalGameRinkDot historicalGameRinkDotShot";
}

function radiusForEvent(
    event: HistoricalGameShotEvent,
    mode: GameDetailChartMode
) {
    if (event.type === "goal" && mode === "goals") {
        return 2.25;
    }

    return 1.75;
}

export default function GameEventRink({ events, mode }: GameEventRinkProps) {
    const [hover, setHover] = useState<{ id: string; left: number; top: number } | null>(null);
    const activeEvent = events.find(event => event.eventId === hover?.id);

    function inspectEvent(event: PointerEvent<SVGSVGElement>, cycle = false) {
        const svg = event.currentTarget;
        const matrix = svg.getScreenCTM();
        if (!matrix) return;
        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        const nearby = events.map(item => ({ item, distance: Math.hypot(item.rinkX - point.x, item.rinkY - point.y) }))
            .filter(item => item.distance <= 4)
            .sort((a, b) => a.distance - b.distance);
        if (!nearby.length) { setHover(null); return; }
        const nearest = nearby[0];
        // Identical coordinates stay accurate; clicking cycles their events.
        const overlapping = nearby.filter(item => Math.hypot(item.item.rinkX - nearest.item.rinkX, item.item.rinkY - nearest.item.rinkY) < 0.1);
        const index = cycle ? (overlapping.findIndex(item => item.item.eventId === hover?.id) + 1) % overlapping.length : 0;
        const rect = svg.getBoundingClientRect();
        setHover({ id: overlapping[index].item.eventId, left: Math.max(12, rect.left - 212), top: Math.max(12, Math.min(event.clientY - 35, window.innerHeight - 180)) });
    }

    const legendItems =
        mode === "goals"
            ? [
                {
                    key: "goal",
                    dotClass:
                        "historicalGameRinkLegendDot historicalGameRinkLegendDotGoal",
                    label: "Goal",
                },
            ]
            : [
                {
                    key: "shot-on-goal",
                    dotClass:
                        "historicalGameRinkLegendDot historicalGameRinkLegendDotShot",
                    label: "Shot on goal",
                },
                {
                    key: "missed-shot",
                    dotClass:
                        "historicalGameRinkLegendDot historicalGameRinkLegendDotMissed",
                    label: "Missed shot",
                },
                {
                    key: "blocked-shot",
                    dotClass:
                        "historicalGameRinkLegendDot historicalGameRinkLegendDotBlocked",
                    label: "Blocked shot",
                },
            ];

    return (
        <div className="historicalGameRinkWrap">
            <div className="historicalGameRinkCanvas">
                <svg
                    className="historicalGameRinkSvg"
                    viewBox="0 0 85 100"
                    xmlns="http://www.w3.org/2000/svg"
                    onPointerMove={event => inspectEvent(event)}
                    onPointerDown={event => inspectEvent(event, true)}
                    onPointerLeave={() => setHover(null)}
                    role="group"
                    aria-label="Offensive zone event map"
                >
                    <defs>
                        <clipPath id="historical-game-rink-mask">
                            <path d="M 1 28 A 27 27 0 0 1 28 1 L 57 1 A 27 27 0 0 1 84 28 L 84 100 L 1 100 Z" />
                        </clipPath>
                    </defs>

                    <path
                        d="M 1 28 A 27 27 0 0 1 28 1 L 57 1 A 27 27 0 0 1 84 28 L 84 100 L 1 100 Z"
                        fill="#f4f4f4"
                        stroke="none"
                    />

                    <g clipPath="url(#historical-game-rink-mask)">
                        <line
                            x1="0"
                            y1="11"
                            x2="85"
                            y2="11"
                            stroke="#cc0000"
                            strokeWidth="0.75"
                        />

                        <path
                            d="M 38.5 11 A 4 4 0 0 0 46.5 11 Z"
                            fill="#e8f2ff"
                            stroke="#cc0000"
                            strokeWidth="0.5"
                        />

                        <circle
                            cx="20.5"
                            cy="31"
                            r="15"
                            stroke="#cc0000"
                            strokeWidth="0.5"
                            fill="none"
                        />
                        <circle cx="20.5" cy="31" r="1" fill="#cc0000" />

                        <g stroke="#cc0000" strokeWidth="0.5" fill="none">
                            <line x1="3.5" y1="28.25" x2="5.5" y2="28.25" />
                            <line x1="3.5" y1="33.75" x2="5.5" y2="33.75" />
                            <line x1="35.5" y1="28.25" x2="37.5" y2="28.25" />
                            <line x1="35.5" y1="33.75" x2="37.5" y2="33.75" />
                            <path d="M 17 29 L 19 29 L 19 27" />
                            <path d="M 17 33 L 19 33 L 19 35" />
                            <path d="M 24 29 L 22 29 L 22 27" />
                            <path d="M 24 33 L 22 33 L 22 35" />
                        </g>

                        <circle
                            cx="64.5"
                            cy="31"
                            r="15"
                            stroke="#cc0000"
                            strokeWidth="0.5"
                            fill="none"
                        />
                        <circle cx="64.5" cy="31" r="1" fill="#cc0000" />

                        <g stroke="#cc0000" strokeWidth="0.5" fill="none">
                            <line x1="47.5" y1="28.25" x2="49.5" y2="28.25" />
                            <line x1="47.5" y1="33.75" x2="49.5" y2="33.75" />
                            <line x1="79.5" y1="28.25" x2="81.5" y2="28.25" />
                            <line x1="79.5" y1="33.75" x2="81.5" y2="33.75" />
                            <path d="M 61 29 L 63 29 L 63 27" />
                            <path d="M 61 33 L 63 33 L 63 35" />
                            <path d="M 68 29 L 66 29 L 66 27" />
                            <path d="M 68 33 L 66 33 L 66 35" />
                        </g>

                        <line
                            x1="0"
                            y1="70"
                            x2="85"
                            y2="70"
                            stroke="#0d4fb0"
                            strokeWidth="1"
                        />

                        <circle cx="14.5" cy="88" r="1" fill="#cc0000" />
                        <circle cx="70.5" cy="88" r="1" fill="#cc0000" />

                        <line
                            x1="2"
                            y1="100"
                            x2="83"
                            y2="100"
                            stroke="#cc0000"
                            strokeWidth="2"
                        />

                        <circle
                            cx="42.5"
                            cy="100"
                            r="15"
                            stroke="#cc0000"
                            strokeWidth="1"
                            fill="none"
                        />
                        <circle cx="42.5" cy="100" r="1.5" fill="#cc0000" />
                    </g>

                    <path
                        d="M 1 28 A 27 27 0 0 1 28 1 L 57 1 A 27 27 0 0 1 84 28 L 84 100 L 1 100 Z"
                        fill="none"
                        stroke="#4b4b4b"
                        strokeWidth="1.5"
                    />

                    {events.map((event) => (
                        <circle
                            key={event.eventId}
                            cx={event.rinkX}
                            cy={event.rinkY}
                            r={radiusForEvent(event, mode)}
                            className={`${dotClassForEvent(event, mode)}${activeEvent?.eventId === event.eventId ? " historicalGameRinkDotActive" : ""}`}
                            tabIndex={0}
                            role="button"
                            aria-label={event.description}
                            onFocus={focus => {
                                const rect = focus.currentTarget.ownerSVGElement!.getBoundingClientRect();
                                setHover({ id: event.eventId, left: Math.max(12, rect.left - 212), top: Math.max(12, Math.min(focus.currentTarget.getBoundingClientRect().top, window.innerHeight - 180)) });
                            }}
                            onBlur={() => setHover(null)}
                            onKeyDown={key => {
                                if (key.key === "Escape") { setHover(null); key.currentTarget.blur(); }
                            }}
                        >

                        </circle>
                    ))}
                </svg>
            </div>

            {activeEvent && hover ? (
                <aside className="historicalGameRinkEventTip" style={{ left: hover.left, top: hover.top }}>
                    <strong>{activeEvent.playerName}</strong>
                    <span>{activeEvent.teamAbbrev} · Period {activeEvent.periodNumber} · {activeEvent.timeInPeriod}</span>
                    <p>{activeEvent.description}</p>
                    {activeEvent.shotType ? <span>{activeEvent.shotType.replaceAll("-", " ")}{activeEvent.strength ? ` · ${activeEvent.strength}` : ""}</span> : null}
                    {events.some(event => event.eventId !== activeEvent.eventId && Math.hypot(event.rinkX - activeEvent.rinkX, event.rinkY - activeEvent.rinkY) < 0.1) ? <small>Overlapping events · click to cycle</small> : null}
                </aside>
            ) : null}

            <div className="historicalGameRinkFooter">
                <div className="historicalGameRinkLegend">
                    {legendItems.map((item) => (
                        <div key={item.key} className="historicalGameRinkLegendItem">
                            <span className={item.dotClass} />
                            <span>{item.label}</span>
                        </div>
                    ))}
                </div>

                <p className="historicalGameRinkMetaText">
                    {events.length} {mode === "goals" ? "goal events" : "shot events"}
                </p>
            </div>
        </div>
    );
}