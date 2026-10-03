import type { Metadata } from "next";
import SeasonSimulator from "./SeasonSimulator";

export const metadata: Metadata = {
    title: "Season Simulator | Game Data",
    description: "NHL projected points and playoff probabilities from 10,000 simulated seasons.",
};

export default function SimulatorPage() {
    return <SeasonSimulator />;
}
