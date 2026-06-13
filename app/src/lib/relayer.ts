/**
 * Thin client for the AccountabiliBuddy relayer (see ../../../relayer/index.ts).
 *
 * The relayer is the oracle/crank service that talks to the Solana
 * `accountability` program on devnet. These helpers let the dashboard show
 * *real* chain status and drive the on-chain flows that the relayer exposes.
 *
 * Base URL is configurable via VITE_RELAYER_URL (defaults to localhost:8787,
 * the relayer's default PORT).
 */

export const RELAYER_URL =
  (import.meta.env.VITE_RELAYER_URL as string | undefined) ??
  "http://localhost:8787";

export interface RelayerHealth {
  ok: boolean;
  oracle: string;
  program: string;
  rpc: string;
  /** Current confirmed slot on the cluster — used as the live "block" counter. */
  slot: number;
  /** Whether MONGODB_URI is set on the relayer. */
  db?: "configured" | "unconfigured";
}

export interface GameResult {
  gameId: string;
  sport: Sport;
  homeWon: boolean | null;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  isFinal: boolean;
  status: string;
}

export interface ScoreboardGame {
  id: string;
  name: string;
  shortName: string;
  status: string;
}

export type Sport = "soccer" | "nba" | "nfl";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${RELAYER_URL}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `relayer ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Liveness + identity of the relayer/oracle and the cluster it's pointed at. */
export function getHealth(): Promise<RelayerHealth> {
  return req<RelayerHealth>("/health");
}

/**
 * Today's games + ESPN game IDs for a given sport. For soccer, pass an optional
 * `league` (e.g. "worldcup", "ucl", "epl") to narrow the board to one competition.
 */
export function getScoreboard(
  sport: Sport,
  league?: string,
): Promise<{ sport: Sport; league: string | null; games: ScoreboardGame[] }> {
  const qs = league ? `&league=${encodeURIComponent(league)}` : "";
  return req(`/scoreboard?sport=${sport}${qs}`);
}

/** Final result for a single ESPN game (null until the game is final). */
export function getGameResult(
  sport: Sport,
  id: string,
): Promise<{ result: GameResult | null }> {
  return req(`/game?sport=${sport}&id=${encodeURIComponent(id)}`);
}

/** Resolve an accountability commitment as successful (oracle signs on-chain). */
export function verifyCommitment(
  commitmentId: string,
): Promise<{ commitmentId: string; signature: string; explorer: string }> {
  return req("/verify", {
    method: "POST",
    body: JSON.stringify({ commitmentId }),
  });
}

/** Trigger the sports-bet settlement crank on the relayer. */
export function settleBets(): Promise<{ ok: boolean }> {
  return req("/settle-bet", { method: "POST" });
}

/**
 * An on-chain 1v1 / group-chat sports wager. No witness is needed — the result
 * is verifiable from the ESPN scoreboard and settled by the oracle crank.
 */
export interface SportsBet {
  pubkey: string;
  creator: string;
  /** null while the bet is still open (no opponent has matched the stake). */
  opponent: string | null;
  amountLamports: number;
  amountSol: number;
  oracle: string;
  sport: Sport;
  /** ESPN game id. */
  gameId: string;
  /** true if the creator backs the home team (opponent gets the away side). */
  creatorBacksHome: boolean;
  /** Kickoff (unix seconds). You can back out up to 5 minutes before this. */
  startTime: number;
  /** Earliest settle time (unix seconds). */
  settleAfter: number;
  state: "open" | "locked" | "settled";
}

/** All on-chain sports bets. */
export function getSportsBets(): Promise<{ bets: SportsBet[] }> {
  return req("/sports-bets");
}

// ── MongoDB-backed dashboard data ─────────────────────────────────────────────
// These resolve once MONGODB_URI is set on the relayer; until then they reject
// with a 503 and the views should keep using their local fixtures.

export interface Group {
  id: string;
  name: string;
  initials: string;
  members: number;
  pendingBet: boolean;
  lastMsg: string;
  time: string;
}

export interface ChatMessage {
  id: string;
  groupId: string;
  sender: string;
  initials: string;
  text?: string;
  betId?: string;
  system: boolean;
  ts: string;
}

export interface Bet {
  id: string;
  type: "PERSONAL" | "DEV";
  challenger: string;
  acceptor: string;
  terms: string;
  stake: string;
  currency: string;
  status: "PENDING" | "ACTIVE" | "RESOLVED";
  witnesses: number;
  minBettors: number;
  groupSize: number;
  commitmentId?: string;
}

export interface Player {
  rank: number;
  name: string;
  initials: string;
  github: string;
  pals: number;
  palsDelta: number;
  sol: number;
  solDelta: number;
  wins: number;
  disputes: number;
  streak: number;
  streakDir: "up" | "down" | "neutral";
}

/** Group-chat list. */
export function getGroups(): Promise<{ groups: Group[] }> {
  return req("/groups");
}

/** Messages for a group, chronological. */
export function getMessages(groupId: string): Promise<{ messages: ChatMessage[] }> {
  return req(`/messages?group=${encodeURIComponent(groupId)}`);
}

/** Append a chat message. */
export function postMessage(input: {
  groupId: string;
  sender: string;
  initials?: string;
  text: string;
}): Promise<{ message: ChatMessage }> {
  return req("/messages", { method: "POST", body: JSON.stringify(input) });
}

/** All bets. */
export function getBets(): Promise<{ bets: Bet[] }> {
  return req("/bets");
}

/** Players ranked by $PALS. */
export function getLeaderboard(): Promise<{ players: Player[] }> {
  return req("/leaderboard");
}
