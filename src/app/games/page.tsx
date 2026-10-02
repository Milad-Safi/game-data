import { getCurrentSeasonId } from "@/lib/nhl/currentSeason";
import { getHistoricalSeasonOptions } from "@/lib/games";
import HistoricalGamesShell from "@/components/games/Shell";

export const dynamic = "force-dynamic";

export default async function GamesPage() {
    try {
        const current = Math.floor(await getCurrentSeasonId() / 10000);
        return (
            <main className="historicalGamesPage">
                <HistoricalGamesShell seasonOptions={getHistoricalSeasonOptions(current)} />
            </main>
        );
    } catch {
        return <main className="historicalGamesPage"><p>Current NHL season is unavailable. Please try again later.</p></main>;
    }
}
