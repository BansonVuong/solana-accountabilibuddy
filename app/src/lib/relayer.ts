/**
 * Thin client for the AccountabiliBuddy relayer (see ../../../relayer/index.ts).
 *
 * The relayer is the oracle/crank service that talks to the Solana
 * `accountability` program on devnet. These helpers let the dashboard show
 * *real* chain status and drive the on-chain flows that the relayer exposes.
 *
 * Base URL is configurable via VITE_RELAYER_URL. By default, local Vite
 * development uses the local relayer and production uses the current origin.
 */

export const RELAYER_URL =
  (import.meta.env.VITE_RELAYER_URL as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:8787" : window.location.origin);
export const AUTH_TOKEN_STORAGE_KEY = "accountabilibuddy_auth_token";
const REQUEST_TIMEOUT_MS = 10_000;

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
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  isFinal: boolean;
  startTime?: string;
  startTimeMs?: number;
}

export type Sport = "soccer" | "nba" | "nfl" | "nhl";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  const token = readStoredAuthToken();
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${RELAYER_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `relayer ${res.status}`);
    }
    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("relayer request timed out");
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
  }
}

function readStoredAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

/** Liveness + identity of the relayer/oracle and the cluster it's pointed at. */
export function getHealth(): Promise<RelayerHealth> {
  return req<RelayerHealth>("/health");
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  initials: string;
  createdAt: number;
}

export interface AuthResult {
  token: string;
  user: AuthUser;
}

export function signupWithEmail(input: {
  email: string;
  username: string;
  password: string;
}): Promise<AuthResult> {
  return req<AuthResult>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function loginWithEmail(input: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  return req<AuthResult>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getCurrentAuthUser(): Promise<{ user: AuthUser }> {
  return req<{ user: AuthUser }>("/auth/me");
}

export interface ProfileSummary {
  name: string;
  initials: string;
  github: string;
  wallet: string;
  /** SOL balance of the account wallet. */
  solBalance: number;
}
/** Profile details plus current SOL balance for the configured profile wallet. */
export function getProfileSummary(): Promise<ProfileSummary> {
  return req<ProfileSummary>("/profile");
}

/**
 * Upcoming sports-feed games currently exposed for sports betting.
 * For soccer, pass an optional `league` alias or numeric league id.
 */
export function getScoreboard(
  sport: Sport,
  league?: string,
): Promise<{ sport: Sport; league: string | null; games: ScoreboardGame[] }> {
  const qs = league ? `&league=${encodeURIComponent(league)}` : "";
  return req(`/scoreboard?sport=${sport}${qs}`);
}

/** Final result for a single game (null until the game is final). */
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
 * is verifiable from the sports feed and settled by the oracle crank.
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
  /** Numeric sports-feed event id. */
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
  memberUsernames?: string[];
  pendingBet: boolean;
  lastMsg: string;
  time: string;
  updatedAt?: number;
}

export interface Profile {
  id: string;
  name: string;
  initials: string;
  github: string;
  bio?: string;
  sol: number;
  wins: number;
  disputes: number;
  streak: number;
  streakDir: "up" | "down" | "neutral";
  /** Placeholder for future per-user total bet volume metric. */
  betCount?: number;
  /** Placeholder for future per-user completion-rate metric (percentage). */
  completionRate?: number;
  createdAt: number;
  updatedAt: number;
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
  createdAt?: number;
}

export type BetVoteChoice = "challenger" | "acceptor";

export interface Bet {
  id: string;
  source?: "imessage";
  groupId?: string;
  type: "PERSONAL" | "DEV";
  challenger: string;
  acceptor: string;
  terms: string;
  stake: string;
  currency: string;
  status: "PENDING" | "ACTIVE" | "RESOLVED" | "COMPLETED";
  witnesses: number;
  minBettors: number;
  groupSize: number;
  votesByVoter?: Record<string, BetVoteChoice>;
  resolvedWinner?: BetVoteChoice;
  acceptedBy?: string;
  acceptedAt?: number;
  commitmentId?: string;
  // ── on-chain escrow (SOL bets only) ──────────────────────────────────────────
  /** True once this bet is escrowed on-chain. */
  onChain?: boolean;
  /** sportsBet PDA backing the escrow. */
  betPda?: string;
  /** Username that staked the opposing side on-chain. */
  opponentUsername?: string;
  /** Lifecycle of the on-chain escrow account. */
  onChainState?: "open" | "locked" | "settled" | "cancelled";
  /** Transaction signatures for the create / accept / settle steps. */
  createSig?: string;
  acceptSig?: string;
  settleSig?: string;
  // ── external-validation (sports bets) ─────────────────────────────────────────
  /** Present for sports bets settled by the sports feed instead of witness votes. */
  validation?: "sports";
  sport?: SportKind;
  /** Legacy field name; stores the sports-feed event id. */
  espnGameId?: string;
  homeTeam?: string;
  awayTeam?: string;
  /** True when the challenger backs the home side. */
  challengerBacksHome?: boolean;
}

/** Alias for the relayer sport union (see {@link Sport}). */
export type SportKind = Sport;

export interface Player {
  rank: number;
  name: string;
  initials: string;
  github: string;
  sol: number;
  solDelta: number;
  wins: number;
  disputes: number;
  streak: number;
  streakDir: "up" | "down" | "neutral";
  /** Placeholder for future per-user total bet volume metric. */
  betCount?: number;
  /** Placeholder for future per-user completion-rate metric (percentage). */
  completionRate?: number;
}

/** Group-chat list. */
export function getGroups(): Promise<{ groups: Group[] }> {
  return req("/groups");
}

/** Create a new chat group. */
export function createGroup(input: {
  name: string;
  initials?: string;
}): Promise<{ group: Group }> {
  return req("/groups", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Add a user (by username) to a group chat. */
export function addGroupMemberByUsername(
  groupId: string,
  username: string,
): Promise<{ group: Group; addedUsername: string; alreadyMember?: boolean }> {
  return req(`/groups/${encodeURIComponent(groupId)}/members`, {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}

/** Messages for a group, chronological. */
export function getMessages(groupId: string): Promise<{ messages: ChatMessage[] }> {
  return req(`/messages?group=${encodeURIComponent(groupId)}`);
}

/** Append a chat message. */
export function postMessage(input: {
  groupId: string;
  text: string;
}): Promise<{ message: ChatMessage }> {
  return req("/messages", { method: "POST", body: JSON.stringify(input) });
}
/** Create a bet and linked system chat message for embedded card rendering. */
export function createBet(input: {
  groupId: string;
  type: "PERSONAL" | "DEV";
  acceptor: string;
  terms: string;
  stake: string;
  currency: "SOL";
  witnesses?: number;
  minBettors?: number;
  /** Witness (non-sports) bets: unix-ms deadline after which the unresolved fallback fires. */
  resolveByDate?: number;
  /** Witness (non-sports) bets: unix-ms accept deadline; omit/null for indefinite. */
  acceptByDate?: number | null;
  // Sports bets (internal DEV type): settled by the sports feed.
  sport?: SportKind;
  gameId?: string;
  backsHome?: boolean;
  homeTeam?: string;
  awayTeam?: string;
}): Promise<{ bet: Bet; message: ChatMessage }> {
  return req("/bets", { method: "POST", body: JSON.stringify(input) });
}

/** Accept a pending challenge as its intended opponent. */
export function acceptBet(betId: string): Promise<{ bet: Bet }> {
  return req("/bets/accept", { method: "POST", body: JSON.stringify({ betId }) });
}

/** All bets. */
export function getBets(): Promise<{ bets: Bet[] }> {
  return req("/bets");
}

/** Cast or update one witness vote for a bet. */
export function voteBet(input: {
  betId: string;
  votedFor: BetVoteChoice;
}): Promise<{ bet: Bet }> {
  return req("/bets/vote", { method: "POST", body: JSON.stringify(input) });
}

/** Solana explorer link for a devnet transaction signature. */
export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

/** Players ranked by SOL balance. */
export function getLeaderboard(): Promise<{ players: Player[] }> {
  return req("/leaderboard");
}

/** All user profiles (Mongo-backed). */
export function getProfiles(): Promise<{ profiles: Profile[] }> {
  return req("/profiles");
}

/** Fetch one profile by id. */
export function getProfile(id: string): Promise<{ profile: Profile }> {
  return req(`/profiles/${encodeURIComponent(id)}`);
}

/** Create a profile document. */
export function createProfile(input: {
  name: string;
  initials?: string;
  github?: string;
  bio?: string;
  sol?: number;
  wins?: number;
  disputes?: number;
  streak?: number;
  streakDir?: "up" | "down" | "neutral";
}): Promise<{ profile: Profile }> {
  return req("/profiles", { method: "POST", body: JSON.stringify(input) });
}

/** Patch an existing profile document by id. */
export function updateProfile(
  id: string,
  input: Partial<Omit<Profile, "id" | "createdAt" | "updatedAt">>,
): Promise<{ profile: Profile }> {
  return req(`/profiles/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
