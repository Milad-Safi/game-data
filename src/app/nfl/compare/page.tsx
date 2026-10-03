import type { Metadata } from "next";
import TeamComparisonShell from "@/components/TeamComparisonShell";

export const metadata: Metadata = {
    title: "NFL Team Comparison | Game Data",
    description: "Compare NFL team offence, defence, conversion rates and positional production using weekly updated nflverse data.",
};

export default function NFLComparePage() {
    return <main className="comparePage"><TeamComparisonShell sport="NFL" /></main>;
}
