import type { GameInfo, TeamRef } from '@huddle/shared';

/**
 * NFL teams as Gemini names them. Gemini event titles use the city ("Tennessee vs Dallas",
 * "Los Angeles C vs Baltimore", "New York J vs ..."), tickers use the short code, and the
 * `participants` array has the full name. Searching Gemini for a nickname ("Cowboys", "49ers")
 * mostly finds college teams, so we translate nicknames to the Gemini city first.
 */
export interface NflTeam {
  /** Codes seen for this team across providers (first = Gemini's). */
  codes: string[];
  /** City as it appears in Gemini event titles. */
  city: string;
  nickname: string;
}

export const NFL_TEAMS: NflTeam[] = [
  { codes: ['ARI', 'ARZ'], city: 'Arizona', nickname: 'Cardinals' },
  { codes: ['ATL'], city: 'Atlanta', nickname: 'Falcons' },
  { codes: ['BAL'], city: 'Baltimore', nickname: 'Ravens' },
  { codes: ['BUF'], city: 'Buffalo', nickname: 'Bills' },
  { codes: ['CAR'], city: 'Carolina', nickname: 'Panthers' },
  { codes: ['CHI'], city: 'Chicago', nickname: 'Bears' },
  { codes: ['CIN'], city: 'Cincinnati', nickname: 'Bengals' },
  { codes: ['CLE'], city: 'Cleveland', nickname: 'Browns' },
  { codes: ['DAL'], city: 'Dallas', nickname: 'Cowboys' },
  { codes: ['DEN'], city: 'Denver', nickname: 'Broncos' },
  { codes: ['DET'], city: 'Detroit', nickname: 'Lions' },
  { codes: ['GB', 'GNB'], city: 'Green Bay', nickname: 'Packers' },
  { codes: ['HOU'], city: 'Houston', nickname: 'Texans' },
  { codes: ['IND'], city: 'Indianapolis', nickname: 'Colts' },
  { codes: ['JAX', 'JAC'], city: 'Jacksonville', nickname: 'Jaguars' },
  { codes: ['KC', 'KAN'], city: 'Kansas City', nickname: 'Chiefs' },
  { codes: ['LV', 'LVR'], city: 'Las Vegas', nickname: 'Raiders' },
  { codes: ['LAC'], city: 'Los Angeles C', nickname: 'Chargers' },
  { codes: ['LAR', 'LA'], city: 'Los Angeles R', nickname: 'Rams' },
  { codes: ['MIA'], city: 'Miami', nickname: 'Dolphins' },
  { codes: ['MIN'], city: 'Minnesota', nickname: 'Vikings' },
  { codes: ['NE', 'NWE'], city: 'New England', nickname: 'Patriots' },
  { codes: ['NO', 'NOR'], city: 'New Orleans', nickname: 'Saints' },
  { codes: ['NYG'], city: 'New York G', nickname: 'Giants' },
  { codes: ['NYJ'], city: 'New York J', nickname: 'Jets' },
  { codes: ['PHI'], city: 'Philadelphia', nickname: 'Eagles' },
  { codes: ['PIT'], city: 'Pittsburgh', nickname: 'Steelers' },
  { codes: ['SF', 'SFO'], city: 'San Francisco', nickname: '49ers' },
  { codes: ['SEA'], city: 'Seattle', nickname: 'Seahawks' },
  { codes: ['TB', 'TAM'], city: 'Tampa Bay', nickname: 'Buccaneers' },
  { codes: ['TEN'], city: 'Tennessee', nickname: 'Titans' },
  { codes: ['WAS', 'WSH'], city: 'Washington', nickname: 'Commanders' },
];

export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Find an NFL team from a code, city, nickname or full name ("DAL", "Dallas", "cowboys", "Dallas Cowboys"). */
export function findNflTeam(text: string | undefined): NflTeam | undefined {
  if (!text) return undefined;
  const t = norm(text);
  if (!t) return undefined;
  const upper = text.trim().toUpperCase();
  return (
    NFL_TEAMS.find((x) => x.codes.includes(upper)) ??
    NFL_TEAMS.find((x) => norm(`${x.city} ${x.nickname}`) === t || norm(x.nickname) === t || norm(x.city) === t) ??
    NFL_TEAMS.find((x) => t.endsWith(` ${norm(x.nickname)}`) || t === norm(`${x.city.replace(/ [A-Z]$/, '')} ${x.nickname}`))
  );
}

export function nflTeamFor(team: TeamRef): NflTeam | undefined {
  return findNflTeam(team.short) ?? findNflTeam(team.name);
}

/** The name Gemini uses for a team in event titles, when we know it. */
export function geminiTitleName(team: TeamRef, sport: GameInfo['sport']): string {
  if (sport === 'nfl') return nflTeamFor(team)?.city ?? team.name;
  return team.name;
}

/** All the strings that can identify a team inside a Gemini event. */
export function teamKeys(team: TeamRef, sport: GameInfo['sport']): { codes: string[]; names: string[] } {
  const codes = new Set<string>([team.short.toUpperCase()]);
  const names = new Set<string>([norm(team.name)]);
  if (sport === 'nfl') {
    const t = nflTeamFor(team);
    if (t) {
      t.codes.forEach((c) => codes.add(c));
      names.add(norm(t.city));
      names.add(norm(t.nickname));
      names.add(norm(`${t.city.replace(/ [A-Z]$/, '')} ${t.nickname}`));
    }
  }
  return { codes: [...codes], names: [...names].filter(Boolean) };
}
