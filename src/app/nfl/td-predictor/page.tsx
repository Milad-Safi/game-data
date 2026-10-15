import type { Metadata } from "next";
import TDPredictor from "./TDPredictor";

export const metadata: Metadata = {
    title: "NFL TD Predictor | Game Data",
    description: "NFL touchdown picks built from current-season red-zone usage, expected-QB connections and opponent tendencies.",
};

export default function Page() { return <TDPredictor />; }
