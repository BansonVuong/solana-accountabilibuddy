// relayer/scraper.ts
//
// Scrapes ESPN scoreboard pages for final game results.
// ESPN embeds a JSON blob in every scoreboard page inside a <script> tag:
//   window['__espnfitt__'] = { ... }
// We fetch the page, extract that blob, and parse the result.
//
// Scoreboard URLs (by sport / game ID):
//   Soccer:  https://www.espn.com/soccer/match?gameId=<id>
//   NBA:     https://www.espn.com/nba/game?gameId=<id>
//   NFL:     https://www.espn.com/nfl/game?gameId=<id>
//
// Game IDs come from the scoreboard index pages:
//   Soccer:  https://www.espn.com/soccer/scoreboard
//   NBA:     https://www.espn.com/nba/scoreboard
//   NFL:     https://www.espn.com/nfl/scoreboard

export type Sport = "soccer" | "nba" | "nfl";

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
  /** Number of days forward (including today) to scrape. */
  daysAhead?: number;
  /** Keep games that have already started. */
  includeStarted?: boolean;
  /** Optional cap after sorting by kickoff time ascending. */
  maxGames?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toEspnDateKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
}

function scoreboardDateUrls(sport: Sport, dateKey: string, league?: string): string[] {
  if (sport === "soccer" && league) {
    const slug = SOCCER_LEAGUES[league] ?? league;
    return [
      `https://www.espn.com/soccer/scoreboard/_/league/${slug}/date/${dateKey}`,
      `https://www.espn.com/soccer/scoreboard/_/date/${dateKey}/league/${slug}`,
      `https://www.espn.com/soccer/scoreboard/_/league/${slug}`,
    ];
  }
  if (sport === "soccer") {
    return [
      `https://www.espn.com/soccer/scoreboard/_/date/${dateKey}`,
      SCOREBOARD_URL.soccer,
    ];
  }
  return [
    `https://www.espn.com/${sport}/scoreboard/_/date/${dateKey}`,
    SCOREBOARD_URL[sport],
  ];
}

function parseScoreboardEvents(blob: Record<string, unknown>): ScoreboardGame[] {
  // Scoreboard pages store events under page.content.scoreboard.evts
  const evts = dig(blob, "page", "content", "scoreboard", "evts");
  if (!Array.isArray(evts)) return [];

  return evts.map((evt: unknown) => {
    const e = evt as Record<string, unknown>;
    const teams = dig(e, "competitors") as Array<Record<string, unknown>> | undefined ?? [];
    const statusDesc = String(dig(e, "status", "desc") ?? "");
    const statusLower = statusDesc.toLowerCase();
    const startTime = String(dig(e, "date") ?? "");
    const parsedStartMs = Date.parse(startTime);
    const startTimeMs = Number.isFinite(parsedStartMs) ? parsedStartMs : undefined;

    // In scoreboard lists, ESPN orders competitors [away, home]
    const away = teams[0] ?? {};
    const home = teams[1] ?? {};

    return {
      gameId:   String(dig(e, "id") ?? dig(e, "gameId") ?? ""),
      homeTeam: String(dig(home, "displayName") ?? dig(home, "abbrev") ?? "Home"),
      awayTeam: String(dig(away, "displayName") ?? dig(away, "abbrev") ?? "Away"),
      status:   statusDesc,
      isFinal:  FINAL_STATUSES.has(statusLower) || statusLower.startsWith("final"),
      startTime: startTime || undefined,
      startTimeMs,
    };
  }).filter((game) => game.gameId !== "");
}

// ── URL builders ─────────────────────────────────────────────────────────────

const GAME_URL: Record<Sport, (id: string) => string> = {
  soccer: (id) => `https://www.espn.com/soccer/match?gameId=${id}`,
  nba:    (id) => `https://www.espn.com/nba/game?gameId=${id}`,
  nfl:    (id) => `https://www.espn.com/nfl/game?gameId=${id}`,
};

const SCOREBOARD_URL: Record<Sport, string> = {
  soccer: "https://www.espn.com/soccer/scoreboard",
  nba:    "https://www.espn.com/nba/scoreboard",
  nfl:    "https://www.espn.com/nfl/scoreboard",
};

// Soccer is organized by competition. ESPN exposes per-league scoreboards at
// /soccer/scoreboard/_/league/<slug>. World Cup lives under "fifa.world".
// Game IDs are global, so fetchGameResult() doesn't need the league — only the
// scoreboard listing does, to narrow down to a single competition.
export const SOCCER_LEAGUES: Record<string, string> = {
  worldcup:           "fifa.world",
  worldcup_qual_uefa: "fifa.worldq.uefa",
  ucl:                "uefa.champions",
  epl:                "eng.1",
  laliga:             "esp.1",
  mls:                "usa.1",
};


// Statuses ESPN uses for completed games
const FINAL_STATUSES = new Set([
  "final", "ft", "full time", "final/ot", "final/so",
  "final/2ot", "final/3ot", "f/ot", "f/so",
]);

// ── fetch helpers ─────────────────────────────────────────────────────────────

const HEADERS = {
  // Pretend to be a real browser — ESPN blocks obvious bot UAs
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`ESPN fetch failed: HTTP ${res.status} for ${url}`);
  return res.text();
}

// ── JSON blob extraction ──────────────────────────────────────────────────────

/**
 * ESPN embeds game data as:
 *   window['__espnfitt__']={"app":{...},"page":{...},...}
 * We grab everything between the first `={` and the closing `};`
 * on that line.
 */
function extractEspnFitt(html: string): Record<string, unknown> | null {
  const match = html.match(/window\[['"]__espnfitt__['"]\]\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── deep-get utility ─────────────────────────────────────────────────────────

// Safely descend into an unknown nested object by key path.
function dig(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

// ── game result parser ────────────────────────────────────────────────────────

/**
 * Parse the __espnfitt__ blob for a single game page.
 * ESPN's structure (simplified):
 *
 * __espnfitt__.page.content.gamepackage.gmStrp
 *   .t (teams array, index 0 = away, index 1 = home in most ESPN sports)
 *   .t[n].displayName
 *   .t[n].score
 *   .status.desc  e.g. "Final", "In Progress", "Scheduled"
 */
function parseGameBlob(
  blob: Record<string, unknown>,
  gameId: string,
  sport: Sport
): GameResult | null {
  // Try the gamepackage path first (single-game pages)
  const gmStrp =
    dig(blob, "page", "content", "gamepackage", "gmStrp") ??
    dig(blob, "page", "content", "gamepackage", "hdr", "gmStrp");

  if (!gmStrp || typeof gmStrp !== "object") return null;

  const teams = dig(gmStrp, "t") as Array<Record<string, unknown>> | undefined;
  const statusDesc = (dig(gmStrp, "status", "desc") as string | undefined) ?? "";
  const statusTxt  = (dig(gmStrp, "status", "txt")  as string | undefined) ?? "";

  if (!Array.isArray(teams) || teams.length < 2) return null;

  // ESPN: teams[0] = away, teams[1] = home (consistent across soccer/nba/nfl)
  const awayTeam  = String(dig(teams[0], "displayName") ?? dig(teams[0], "abbrev") ?? "Away");
  const homeTeam  = String(dig(teams[1], "displayName") ?? dig(teams[1], "abbrev") ?? "Home");
  const awayScore = Number(dig(teams[0], "score") ?? -1);
  const homeScore = Number(dig(teams[1], "score") ?? -1);

  const statusLower = (statusDesc + " " + statusTxt).toLowerCase().trim();
  const isFinal = FINAL_STATUSES.has(statusLower) ||
    statusLower.startsWith("final") ||
    statusLower === "ft";

  let homeWon: boolean | null = null;
  if (isFinal && awayScore >= 0 && homeScore >= 0) {
    if (homeScore > awayScore) homeWon = true;
    else if (awayScore > homeScore) homeWon = false;
    else homeWon = null; // draw/tie
  }

  return {
    gameId,
    sport,
    homeWon,
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    isFinal,
    status: statusDesc || statusTxt,
  };
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Fetch the result of a single game.
 * Returns null if the game is not yet final.
 */
export async function fetchGameResult(
  sport: Sport,
  gameId: string
): Promise<GameResult | null> {
  const url = GAME_URL[sport](gameId);
  const html = await fetchPage(url);
  const blob = extractEspnFitt(html);

  if (!blob) {
    // Fallback: try to extract from the older `window.espnData` format
    throw new Error(
      `Could not find ESPN data blob for game ${gameId}. ` +
      `Check that the game ID is correct and the game page exists at ${url}`
    );
  }

  const result = parseGameBlob(blob, gameId, sport);
  if (!result) return null;
  if (!result.isFinal) return null;
  return result;
}

// ── scoreboard listing ────────────────────────────────────────────────────────

export interface ScoreboardGame {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  isFinal: boolean;
  startTime?: string;
  startTimeMs?: number;
}

/**
 * Scrape scoreboard pages for upcoming games across a short rolling window.
 * Useful for letting users pick a game ID without knowing it in advance.
 */
export async function fetchScoreboard(
  sport: Sport,
  league?: string,
  options: FetchScoreboardOptions = {},
): Promise<ScoreboardGame[]> {
  const nowMs = Date.now();
  const daysAhead = Math.max(0, Math.min(10, Math.floor(options.daysAhead ?? 2)));
  const includeStarted = options.includeStarted === true;
  const gamesById = new Map<string, ScoreboardGame>();

  for (let offset = 0; offset <= daysAhead; offset += 1) {
    const dateKey = toEspnDateKey(nowMs + offset * DAY_MS);
    const urls = scoreboardDateUrls(sport, dateKey, league);
    let dayGames: ScoreboardGame[] | null = null;

    for (const url of urls) {
      try {
        const html = await fetchPage(url);
        const blob = extractEspnFitt(html);
        if (!blob) continue;
        dayGames = parseScoreboardEvents(blob);
        break;
      } catch {
        // Try the next URL pattern (ESPN path conventions vary by sport/league).
      }
    }

    if (!dayGames || dayGames.length === 0) continue;

    for (const game of dayGames) {
      const existing = gamesById.get(game.gameId);
      if (!existing) {
        gamesById.set(game.gameId, game);
        continue;
      }
      const existingStart = existing.startTimeMs ?? Number.POSITIVE_INFINITY;
      const nextStart = game.startTimeMs ?? Number.POSITIVE_INFINITY;
      if (nextStart < existingStart) {
        gamesById.set(game.gameId, game);
      }
    }
  }

  let games = Array.from(gamesById.values())
    .filter((game) => includeStarted || !game.startTimeMs || game.startTimeMs > nowMs)
    .sort((a, b) => {
      const aStart = a.startTimeMs ?? Number.POSITIVE_INFINITY;
      const bStart = b.startTimeMs ?? Number.POSITIVE_INFINITY;
      if (aStart === bStart) return a.gameId.localeCompare(b.gameId);
      return aStart - bStart;
    });

  const maxGames = options.maxGames ? Math.max(1, Math.floor(options.maxGames)) : 0;
  if (maxGames > 0) games = games.slice(0, maxGames);
  return games;
}
