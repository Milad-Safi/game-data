// Brand palettes from nflverse teams_colors_logos. Prefer a visible brand
// colour on the dark background; use another brand colour for close matchups.
export const NFL_ASSETS: Record<string, { logo: string; colors: readonly string[] }> = {
    ARI: { logo: 'cardinals', colors: ['#97233F', '#000000'] },
    ATL: { logo: 'falcons', colors: ['#A71930', '#000000'] },
    BAL: { logo: 'ravens', colors: ['#241773', '#9E7C0C'] },
    BUF: { logo: 'bills', colors: ['#00338D', '#C60C30'] },
    CAR: { logo: 'panthers', colors: ['#0085CA', '#000000'] },
    CHI: { logo: 'bears', colors: ['#E64100', '#0B162A'] },
    CIN: { logo: 'bengals', colors: ['#FB4F14', '#000000'] },
    CLE: { logo: 'browns', colors: ['#FF3C00', '#311D00'] },
    DAL: { logo: 'cowboys', colors: ['#B0B7BC', '#002244'] },
    DEN: { logo: 'broncos', colors: ['#FB4F14', '#002244'] },
    DET: { logo: 'lions', colors: ['#0076B6', '#B0B7BC'] },
    GB: { logo: 'packers', colors: ['#203731', '#FFB612'] },
    HOU: { logo: 'texans', colors: ['#A71930', '#03202F'] },
    IND: { logo: 'colts', colors: ['#002C5F', '#A5ACAF'] },
    JAX: { logo: 'jaguars', colors: ['#006778', '#000000'] },
    KC: { logo: 'chiefs', colors: ['#E31837', '#FFB612'] },
    LAC: { logo: 'chargers', colors: ['#007BC7', '#FFC20E'] },
    LAR: { logo: 'rams', colors: ['#003594', '#FFD100'] },
    LV: { logo: 'raiders', colors: ['#A5ACAF', '#000000'] },
    MIA: { logo: 'dolphins', colors: ['#008E97', '#F58220'] },
    MIN: { logo: 'vikings', colors: ['#4F2683', '#FFC62F'] },
    NE: { logo: 'patriots', colors: ['#C60C30', '#002244'] },
    NO: { logo: 'saints', colors: ['#D3BC8D', '#000000'] },
    NYG: { logo: 'giants', colors: ['#0B2265', '#A71930'] },
    NYJ: { logo: 'jets', colors: ['#003F2D', '#000000'] },
    PHI: { logo: 'eagles', colors: ['#004C54', '#A5ACAF'] },
    PIT: { logo: 'steelers', colors: ['#FFB612', '#000000'] },
    SEA: { logo: 'seahawks', colors: ['#69BE28', '#002244'] },
    SF: { logo: '49ers', colors: ['#AA0000', '#B3995D'] },
    TB: { logo: 'buccaneers', colors: ['#A71930', '#322F2B'] },
    TEN: { logo: 'titans', colors: ['#4495D2', '#D50A0A'] },
    WAS: { logo: 'commanders', colors: ['#5A1414', '#FFB612'] },
};
export const getNFLLogo = (team: string) => NFL_ASSETS[team] ? `/${NFL_ASSETS[team].logo}.webp` : undefined;
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const distance = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));

export function getNFLMatchupColors(left: string, right: string): [string, string] {
    // Sort identities so swapping sides keeps each team's assigned colour.
    const [a, b] = [left, right].sort();
    const ca = NFL_ASSETS[a]?.colors ?? ['#617A9C'];
    const cb = NFL_ASSETS[b]?.colors ?? ['#78869A'];
    let pair: [string, string] = [ca[0], cb[0]];
    if (distance(...pair) < 100) {
        let best = -Infinity;
        ca.forEach((x, i) => cb.forEach((y, j) => {
            const score = distance(x, y) - 35 * (i + j);
            if (score > best) { best = score; pair = [x, y]; }
        }));
    }
    return left === a ? pair : [pair[1], pair[0]];
}
