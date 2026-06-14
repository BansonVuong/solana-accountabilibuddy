// relayer/scraper.ts
//
// Sports data provider backed by TheSportsDB.
// Endpoints used:
//   - /eventsnextleague.php?id=<leagueId>
//   - /eventspastleague.php?id=<leagueId>
//   - /lookupevent.php?id=<eventId>

export type Sport = "soccer" | "nba" | "nfl" | "nhl";

export interface GameResult {
  gameId: string;
  sport: Sport;
  /** True if the home team won, false if away won, null if draw/tie. */
  homeWon: boolean | null;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  /** Whether the game clock shows a completed state. */
  isFinal: boolean;
  status: string;
}

export interface FetchScoreboardOptions {
  /** Number of days forward (including today) to include. */
  daysAhead?: number;
  /** Keep games that have already started. */
  includeStarted?: boolean;
  /** Optional cap after sorting by kickoff time ascending. */
  maxGames?: number;
}

export interface ScoreboardGame {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  isFinal: boolean;
  startTime?: string;
  startTimeMs?: number;
}

type SportsDbEvent = {
  idEvent?: string | null;
  strTimestamp?: string | null;
  dateEvent?: string | null;
  strTime?: string | null;
  strStatus?: string | null;
  strHomeTeam?: string | null;
  strAwayTeam?: string | null;
  intHomeScore?: string | null;
  intAwayScore?: string | null;
};

const SPORTSDB_API_BASE = (process.env.SPORTSDB_API_BASE ?? "https://www.thesportsdb.com/api/v1/json").replace(/\/+$/, "");
const SPORTSDB_API_KEY = process.env.SPORTSDB_API_KEY ?? "3";
const SPORTSDB_TIMEOUT_MS = Number(process.env.SPORTSDB_TIMEOUT_MS ?? 12_000);
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_LEAGUE_BY_SPORT: Record<Sport, string> = {
  soccer: "4346", // MLS
  nba: "4387",
  nfl: "4391",
  nhl: "4380",
};

// Optional soccer league aliases accepted by /scoreboard?sport=soccer&league=...
// You can also pass a raw TheSportsDB numeric league ID directly.
export const SOCCER_LEAGUES: Record<string, string> = {
  epl: "4328",
  laliga: "4335",
  mls: "4346",
};

const FINAL_STATUSES = new Set([
  "ft",
  "aet",
  "ft_pen",
  "final",
  "full time",
  "match finished",
]);

function normalizeStatus(value: string | null | undefined): string {
  return `${value ?? ""}`.trim();
}

function parseScore(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStartTimeMs(event: SportsDbEvent): number | undefined {
  const direct = event.strTimestamp ? Date.parse(event.strTimestamp) : NaN;
  if (Number.isFinite(direct)) return direct;

  if (event.dateEvent && event.strTime) {
    const fallback = Date.parse(`${event.dateEvent}T${event.strTime}Z`);
    if (Number.isFinite(fallback)) return fallback;
  }
  return undefined;
}

function isFinalStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return FINAL_STATUSES.has(normalized) || normalized.startsWith("final");
}

function toScoreboardGame(event: SportsDbEvent): ScoreboardGame | null {
  const gameId = `${event.idEvent ?? ""}`.trim();
  if (!gameId) return null;

  const status = normalizeStatus(event.strStatus) || "Scheduled";
  const startTimeMs = parseStartTimeMs(event);
  const homeScore = parseScore(event.intHomeScore);
  const awayScore = parseScore(event.intAwayScore);

  return {
    gameId,
    homeTeam: `${event.strHomeTeam ?? "Home"}`.trim() || "Home",
    awayTeam: `${event.strAwayTeam ?? "Away"}`.trim() || "Away",
    status,
    isFinal: isFinalStatus(status) || (homeScore !== null && awayScore !== null && status.toLowerCase() === "ft"),
    startTime: typeof startTimeMs === "number" ? new Date(startTimeMs).toISOString() : undefined,
    startTimeMs,
  };
}

function resolveLeagueId(sport: Sport, league?: string): string {
  if (sport !== "soccer") return DEFAULT_LEAGUE_BY_SPORT[sport];
  if (!league) return DEFAULT_LEAGUE_BY_SPORT.soccer;

  const normalized = league.trim().toLowerCase();
  if (/^\d+$/.test(normalized)) return normalized;
  return SOCCER_LEAGUES[normalized] ?? DEFAULT_LEAGUE_BY_SPORT.soccer;
}

async function fetchSportsDb<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params);
  const url = `${SPORTSDB_API_BASE}/${encodeURIComponent(SPORTSDB_API_KEY)}/${endpoint}?${qs.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SPORTSDB_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`TheSportsDB fetch failed: HTTP ${res.status} for ${url}`);
    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`TheSportsDB request timed out for ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLeagueEvents(
  endpoint: "eventsnextleague.php" | "eventspastleague.php",
  leagueId: string,
): Promise<SportsDbEvent[]> {
  const payload = await fetchSportsDb<{ events?: SportsDbEvent[] | null }>(endpoint, { id: leagueId });
  return Array.isArray(payload.events) ? payload.events : [];
}

/**
 * Fetch the result of a single TheSportsDB event.
 * Returns null if the game is not yet final.
 */
export async function fetchGameResult(
  sport: Sport,
  gameId: string,
): Promise<GameResult | null> {
  const payload = await fetchSportsDb<{ events?: SportsDbEvent[] | null }>("lookupevent.php", {
    id: gameId,
  });
  const event = Array.isArray(payload.events) ? payload.events[0] : null;
  if (!event) throw new Error(`TheSportsDB event ${gameId} was not found`);

  const status = normalizeStatus(event.strStatus) || "Scheduled";
  if (!isFinalStatus(status)) return null;

  const homeScore = parseScore(event.intHomeScore);
  const awayScore = parseScore(event.intAwayScore);
  if (homeScore === null || awayScore === null) return null;

  let homeWon: boolean | null = null;
  if (homeScore > awayScore) homeWon = true;
  else if (awayScore > homeScore) homeWon = false;

  return {
    gameId,
    sport,
    homeWon,
    homeTeam: `${event.strHomeTeam ?? "Home"}`.trim() || "Home",
    awayTeam: `${event.strAwayTeam ?? "Away"}`.trim() || "Away",
    homeScore,
    awayScore,
    isFinal: true,
    status,
  };
}

/**
 * Fetch upcoming league events from TheSportsDB and return normalized games.
 * `daysAhead` limits the horizon; `includeStarted` optionally includes recent
 * past fixtures to let callers validate "already started" selections.
 */
export async function fetchScoreboard(
  sport: Sport,
  league?: string,
  options: FetchScoreboardOptions = {},
): Promise<ScoreboardGame[]> {
  const nowMs = Date.now();
  const daysAhead = Math.max(0, Math.min(30, Math.floor(options.daysAhead ?? 2)));
  const includeStarted = options.includeStarted === true;
  const leagueId = resolveLeagueId(sport, league);

  const [nextEvents, pastEvents] = await Promise.all([
    fetchLeagueEvents("eventsnextleague.php", leagueId),
    includeStarted ? fetchLeagueEvents("eventspastleague.php", leagueId) : Promise.resolve([] as SportsDbEvent[]),
  ]);

  const recentPastWindowStart = nowMs - DAY_MS;
  const horizonMs = nowMs + daysAhead * DAY_MS;
  const gamesById = new Map<string, ScoreboardGame>();

  for (const event of [...pastEvents, ...nextEvents]) {
    const game = toScoreboardGame(event);
    if (!game) continue;

    if (typeof game.startTimeMs === "number") {
      if (game.startTimeMs > horizonMs) continue;
      if (!includeStarted && game.startTimeMs <= nowMs) continue;
      if (includeStarted && game.startTimeMs < recentPastWindowStart) continue;
    }

    const existing = gamesById.get(game.gameId);
    if (!existing) {
      gamesById.set(game.gameId, game);
      continue;
    }
    const existingStart = existing.startTimeMs ?? Number.POSITIVE_INFINITY;
    const nextStart = game.startTimeMs ?? Number.POSITIVE_INFINITY;
    if (nextStart < existingStart) gamesById.set(game.gameId, game);
  }

  let games = Array.from(gamesById.values()).sort((a, b) => {
    const aStart = a.startTimeMs ?? Number.POSITIVE_INFINITY;
    const bStart = b.startTimeMs ?? Number.POSITIVE_INFINITY;
    if (aStart === bStart) return a.gameId.localeCompare(b.gameId);
    return aStart - bStart;
  });

  const maxGames = options.maxGames ? Math.max(1, Math.floor(options.maxGames)) : 0;
  if (maxGames > 0) games = games.slice(0, maxGames);
  return games;
}
