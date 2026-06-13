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
}

/**
 * Scrape the scoreboard index for a sport and return today's games.
 * Useful for letting users pick a game ID without knowing it in advance.
 */
export async function fetchScoreboard(sport: Sport): Promise<ScoreboardGame[]> {
  const url = SCOREBOARD_URL[sport];
  const html = await fetchPage(url);
  const blob = extractEspnFitt(html);
  if (!blob) return [];

  // Scoreboard pages store events under page.content.scoreboard.evts
  const evts = dig(blob, "page", "content", "scoreboard", "evts");
  if (!Array.isArray(evts)) return [];

  return evts.map((evt: unknown) => {
    const e = evt as Record<string, unknown>;
    const teams = dig(e, "competitors") as Array<Record<string, unknown>> | undefined ?? [];
    const statusDesc = String(dig(e, "status", "desc") ?? "");
    const statusLower = statusDesc.toLowerCase();

    // In scoreboard lists, ESPN orders competitors [away, home]
    const away = teams[0] ?? {};
    const home = teams[1] ?? {};

    return {
      gameId:   String(dig(e, "id") ?? dig(e, "gameId") ?? ""),
      homeTeam: String(dig(home, "displayName") ?? dig(home, "abbrev") ?? "Home"),
      awayTeam: String(dig(away, "displayName") ?? dig(away, "abbrev") ?? "Away"),
      status:   statusDesc,
      isFinal:  FINAL_STATUSES.has(statusLower) || statusLower.startsWith("final"),
      startTime: String(dig(e, "date") ?? ""),
    };
  }).filter(g => g.gameId !== "");
}
