import type { Metadata } from "next";
import HomePage from "../HomePage";

export const metadata: Metadata = {
    title: "NFL | Game Data",
    description: "Explore the NFL team comparison preview on Game Data. Statistics are placeholders.",
};

export default function NFLPage() {
    return <HomePage sport="NFL" />;
}
