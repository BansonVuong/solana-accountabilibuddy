import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Github,
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
  Flame,
  Star,
  BarChart3,
} from "lucide-react";
import { Avatar, Card, Mono } from "./ui";
import {
  getBets,
  getGroups,
  getLeaderboard,
  getMessages,
  getProfiles,
  type Bet,
  type BetVoteChoice,
  type ChatMessage,
  type Group,
  type Player as RelayerPlayer,
  type Profile,
} from "../../lib/relayer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

/* ── Types & data ──────────────────────────────────────── */

interface Player {
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
}

interface BetHistoryOutcome {
  betId: string;
  challengerKey: string;
  acceptorKey: string;
  winnerKey: string;
  stake: number;
}

interface BetPerformance {
  key: string;
  name: string;
  initials: string;
  github: string;
  wins: number;
  losses: number;
  resolved: number;
  winRate: number;
  totalWon: number;
  totalLost: number;
  net: number;
}

function fromProfile(profile: Profile, rank: number): Player {
  return {
    rank,
    name: profile.name,
    initials: profile.initials,
    github: profile.github,
    sol: profile.sol,
    solDelta: 0,
    wins: profile.wins,
    disputes: profile.disputes,
    streak: profile.streak,
    streakDir: profile.streakDir,
  };
}

function fromRelayerPlayer(player: RelayerPlayer, rank: number): Player {
  return {
    rank,
    name: player.name,
    initials: player.initials,
    github: player.github,
    sol: player.sol,
    solDelta: player.solDelta,
    wins: player.wins,
    disputes: player.disputes,
    streak: player.streak,
    streakDir: player.streakDir,
  };
}

function normalizeHandle(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function toInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "NA";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}


function parseStakeAmount(stake: string): number {
  const normalized = stake.replace(/[^\d.-]/g, "");
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

function formatStakeAmount(value: number, currency: string): string {
  if (currency === "SOL") return value.toFixed(2);
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatSignedStakeAmount(value: number, currency: string): string {
  return `${value > 0 ? "+" : ""}${formatStakeAmount(value, currency)} ${currency}`;
}

function getVotesByVoter(bet: Bet): Record<string, BetVoteChoice> {
  return bet.votesByVoter ?? {};
}

function countVotes(bet: Bet): { challenger: number; acceptor: number; total: number } {
  let challenger = 0;
  let acceptor = 0;
  for (const vote of Object.values(getVotesByVoter(bet))) {
    if (vote === "challenger") challenger += 1;
    if (vote === "acceptor") acceptor += 1;
  }
  return { challenger, acceptor, total: challenger + acceptor };
}

function getResolvedWinner(bet: Bet): BetVoteChoice | undefined {
  if (bet.status === "PENDING") return undefined;
  if (bet.resolvedWinner) return bet.resolvedWinner;
  const votes = countVotes(bet);
  const threshold = Math.max(1, Number(bet.witnesses) || 1);
  if (votes.challenger >= threshold) return "challenger";
  if (votes.acceptor >= threshold) return "acceptor";
  return undefined;
}

function isBetCompleted(bet: Bet): boolean {
  return bet.status === "COMPLETED" || bet.status === "RESOLVED" || Boolean(getResolvedWinner(bet));
}

/* ── Rank badge ────────────────────────────────────────── */
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy size={16} style={{ color: "#FFB800" }} />;
  if (rank === 2) return <Star size={15} style={{ color: "#94A3B8" }} />;
  if (rank === 3) return <Star size={14} style={{ color: "#CD7F32" }} />;
  return <Mono className="text-muted-foreground" style={{ fontSize: "12px" } as React.CSSProperties}>#{rank}</Mono>;
}

/* ── Delta cell ────────────────────────────────────────── */
function Delta({ value, unit }: { value: number; unit: string }) {
  if (value === 0) return (
    <div className="flex items-center gap-1 justify-end text-muted-foreground">
      <Minus size={11} />
      <Mono style={{ fontSize: "12px" } as React.CSSProperties}>—</Mono>
    </div>
  );
  const pos = value > 0;
  return (
    <div className="flex items-center gap-1 justify-end" style={{ color: pos ? "#14F195" : "#FF4A4A" }}>
      {pos ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      <Mono style={{ fontSize: "12px" } as React.CSSProperties}>
        {pos ? "+" : ""}
        {unit === "SOL" ? value.toFixed(2) : value.toLocaleString()} {unit}
      </Mono>
    </div>
  );
}

/* ── Bet metric cell ───────────────────────────────────── */
function BetMetricsCell({
  stats,
  currency,
}: {
  stats: BetPerformance | null;
  currency: string;
}) {
  if (!stats || stats.resolved === 0) {
    return (
      <div className="space-y-0.5">
        <Mono className="text-muted-foreground block" style={{ fontSize: "10px" } as React.CSSProperties}>
          No settled bets
        </Mono>
        <Mono className="text-muted-foreground block" style={{ fontSize: "10px" } as React.CSSProperties}>
          waiting for chat history
        </Mono>
      </div>
    );
  }

  const netColor = stats.net > 0 ? "#14F195" : stats.net < 0 ? "#FF4A4A" : "var(--muted-foreground)";
  return (
    <div className="space-y-0.5">
      <Mono className="text-foreground block" style={{ fontSize: "10px" } as React.CSSProperties}>
        {stats.wins}W-{stats.losses}L · {stats.winRate.toFixed(0)}%
      </Mono>
      <Mono className="block" style={{ fontSize: "10px", color: netColor } as React.CSSProperties}>
        {formatSignedStakeAmount(stats.net, currency)} net
      </Mono>
    </div>
  );
}

function WinRateBar({ winRate }: { winRate: number }) {
  const color = winRate >= 60 ? "#14F195" : winRate >= 40 ? "#FFB800" : "#FF4A4A";
  return (
    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{
          width: `${Math.max(0, Math.min(100, winRate))}%`,
          background: color,
        }}
      />
    </div>
  );
}

/* ── Main view ─────────────────────────────────────────── */
export function LeaderboardView() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState("");

  const [players, setPlayers] = useState<Player[]>([]);
  const [bets, setBets] = useState<Bet[]>([]);
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [playersLive, setPlayersLive] = useState(false);
  const [groupsLive, setGroupsLive] = useState(false);
  const [historyLive, setHistoryLive] = useState(false);

  useEffect(() => {
    let alive = true;

    const load = async (): Promise<void> => {
      const [groupsResult, profilesResult, betsResult] = await Promise.allSettled([
        getGroups(),
        getProfiles(),
        getBets(),
      ]);
      if (!alive) return;

      if (groupsResult.status === "fulfilled") {
        const nextGroups = groupsResult.value.groups;
        setGroups(nextGroups);
        setGroupsLive(true);
        setActiveGroupId((currentId) => (
          nextGroups.some((group) => group.id === currentId)
            ? currentId
            : nextGroups[0]?.id ?? ""
        ));
      } else {
        setGroups([]);
        setGroupsLive(false);
        setActiveGroupId("");
      }

      if (betsResult.status === "fulfilled") {
        setBets(betsResult.value.bets);
      } else {
        setBets([]);
      }

      if (profilesResult.status === "fulfilled" && profilesResult.value.profiles.length) {
        const mapped = [...profilesResult.value.profiles]
          .sort((a, b) => b.sol - a.sol)
          .map((profile, index) => fromProfile(profile, index + 1));
        setPlayers(mapped);
        setPlayersLive(true);
        return;
      }

      try {
        const { players: relayerPlayers } = await getLeaderboard();
        if (!alive) return;
        if (relayerPlayers.length) {
          const mapped = [...relayerPlayers]
            .sort((a, b) => b.sol - a.sol)
            .map((player, index) => fromRelayerPlayer(player, index + 1));
          setPlayers(mapped);
          setPlayersLive(true);
        } else {
          setPlayers([]);
          setPlayersLive(false);
        }
      } catch {
        if (!alive) return;
        setPlayers([]);
        setPlayersLive(false);
      }
    };

    void load();
    const interval = setInterval(() => {
      void load();
    }, 3_000);

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let alive = true;

    if (!activeGroupId) {
      setHistoryMessages([]);
      setHistoryLive(false);
      return () => {
        alive = false;
      };
    }

    const loadHistory = async (): Promise<void> => {
      try {
        const { messages } = await getMessages(activeGroupId);
        if (!alive) return;
        setHistoryMessages(messages);
        setHistoryLive(true);
      } catch {
        if (!alive) return;
        setHistoryMessages([]);
        setHistoryLive(false);
      }
    };

    void loadHistory();
    const interval = setInterval(() => {
      void loadHistory();
    }, 3_000);

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [activeGroupId]);

  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId) ?? null,
    [activeGroupId, groups],
  );

  const activeGroupMembers = useMemo(
    () => (activeGroup?.memberUsernames ?? [])
      .map((username) => username.trim().toLowerCase())
      .filter(Boolean),
    [activeGroup],
  );

  const groupPlayers = useMemo(() => {
    if (!activeGroup) return [];
    if (!activeGroupMembers.length) return players;
    const members = new Set(activeGroupMembers);
    return players.filter((player) => {
      const github = normalizeHandle(player.github);
      const name = player.name.trim().toLowerCase();
      return members.has(github) || members.has(name);
    });
  }, [activeGroup, activeGroupMembers, players]);

  const sorted = useMemo(
    () => [...groupPlayers].sort((a, b) => b.sol - a.sol),
    [groupPlayers],
  );

  const historyBetIds = useMemo(
    () => new Set(historyMessages
      .map((message) => message.betId)
      .filter((id): id is string => Boolean(id))),
    [historyMessages],
  );

  const historyBets = useMemo(() => {
    const byMessage = bets.filter((bet) => historyBetIds.has(bet.id));
    if (byMessage.length) return byMessage;
    if (!activeGroup) return [];
    return bets.filter((bet) => bet.groupId === activeGroup.id);
  }, [activeGroup, bets, historyBetIds]);


  const resolvedOutcomes = useMemo(
    () => historyBets
      .filter((bet) => isBetCompleted(bet))
      .map((bet): BetHistoryOutcome | null => {
        const winner = getResolvedWinner(bet);
        if (!winner) return null;
        const currency = bet.currency.trim().toUpperCase();
        if (currency !== "SOL") return null;

        const challengerKey = normalizeHandle(bet.challenger);
        const acceptorKey = normalizeHandle(bet.acceptor);
        const winnerKey = winner === "challenger" ? challengerKey : acceptorKey;
        if (!winnerKey || winnerKey === "anyone") return null;

        return {
          betId: bet.id,
          challengerKey,
          acceptorKey,
          winnerKey,
          stake: parseStakeAmount(bet.stake),
        };
      })
      .filter((entry): entry is BetHistoryOutcome => Boolean(entry)),
    [historyBets],
  );

  const identityByKey = useMemo(() => {
    const map = new Map<string, { name: string; initials: string; github: string }>();
    for (const player of players) {
      const githubKey = normalizeHandle(player.github);
      if (githubKey && !map.has(githubKey)) {
        map.set(githubKey, {
          name: player.name,
          initials: player.initials,
          github: player.github,
        });
      }

      const nameKey = normalizeHandle(player.name);
      if (nameKey && !map.has(nameKey)) {
        map.set(nameKey, {
          name: player.name,
          initials: player.initials,
          github: player.github,
        });
      }
    }

    for (const username of activeGroup?.memberUsernames ?? []) {
      const key = normalizeHandle(username);
      if (!key || map.has(key)) continue;
      map.set(key, {
        name: username,
        initials: toInitials(username),
        github: username,
      });
    }
    return map;
  }, [activeGroup?.memberUsernames, players]);

  const betPerformance = useMemo(() => {
    type MutableBetPerformance = BetPerformance;
    const byPlayer = new Map<string, MutableBetPerformance>();

    const ensurePlayer = (key: string): MutableBetPerformance | null => {
      if (!key || key === "anyone") return null;
      const existing = byPlayer.get(key);
      if (existing) return existing;
      const knownIdentity = identityByKey.get(key);
      const created: MutableBetPerformance = {
        key,
        name: knownIdentity?.name ?? key,
        initials: knownIdentity?.initials ?? toInitials(key),
        github: knownIdentity?.github ?? key,
        wins: 0,
        losses: 0,
        resolved: 0,
        winRate: 0,
        totalWon: 0,
        totalLost: 0,
        net: 0,
      };
      byPlayer.set(key, created);
      return created;
    };

    for (const outcome of resolvedOutcomes) {
      const winner = ensurePlayer(outcome.winnerKey);
      const loserKey = outcome.winnerKey === outcome.challengerKey
        ? outcome.acceptorKey
        : outcome.challengerKey;
      const loser = ensurePlayer(loserKey);

      if (winner) {
        winner.wins += 1;
        winner.totalWon += outcome.stake;
      }
      if (loser) {
        loser.losses += 1;
        loser.totalLost += outcome.stake;
      }
    }

    return [...byPlayer.values()]
      .map((entry) => {
        const resolved = entry.wins + entry.losses;
        const winRate = resolved > 0 ? (entry.wins / resolved) * 100 : 0;
        const net = entry.totalWon - entry.totalLost;
        return { ...entry, resolved, winRate, net };
      })
      .filter((entry) => entry.resolved > 0)
      .sort((a, b) =>
        b.wins - a.wins
        || b.winRate - a.winRate
        || b.net - a.net
        || a.name.localeCompare(b.name)
      );
  }, [identityByKey, resolvedOutcomes]);

  const betPerformanceByKey = useMemo(() => {
    const map = new Map<string, BetPerformance>();
    for (const row of betPerformance) {
      map.set(row.key, row);
      map.set(normalizeHandle(row.github), row);
      map.set(normalizeHandle(row.name), row);
    }
    return map;
  }, [betPerformance]);

  const displayCurrency = "SOL";
  const topWinner = betPerformance[0] ?? null;
  const highestWinRate = useMemo(() => {
    const qualified = betPerformance.filter((entry) => entry.resolved >= 2);
    if (!qualified.length) return betPerformance[0] ?? null;
    return [...qualified].sort((a, b) => b.winRate - a.winRate)[0] ?? null;
  }, [betPerformance]);
  const biggestNet = useMemo(() => (
    [...betPerformance].sort((a, b) => b.net - a.net)[0] ?? null
  ), [betPerformance]);

  return (
    <Card>
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(255,184,0,0.1)", border: "1px solid rgba(255,184,0,0.2)" }}>
            <Trophy size={16} style={{ color: "#FFB800" }} />
          </div>
          <div>
            <Mono
              className="text-muted-foreground uppercase block"
              style={{ fontSize: "9px", letterSpacing: "0.1em" } as React.CSSProperties}
            >
              Leaderboard
            </Mono>
            <p className="text-foreground" style={{ fontSize: "15px", fontWeight: 700 }}>Group standings (SOL balance)</p>
            <p className="text-muted-foreground" style={{ fontSize: "11px" }}>
              {activeGroup
                ? `${sorted.length} ranked players in ${activeGroup.name} · ${playersLive ? "leaderboard live" : "leaderboard pending"} · ${historyLive ? "history synced" : "history pending"}`
                : groups.length
                  ? "Choose a group to view rankings"
                  : groupsLive
                    ? "No groups joined yet"
                    : "waiting for group data"}
            </p>
          </div>
        </div>
        <div className="w-56 space-y-1">
          <Mono
            className="text-muted-foreground uppercase block"
            style={{ fontSize: "9px", letterSpacing: "0.1em" } as React.CSSProperties}
          >
            Group filter
          </Mono>
          <Select
            value={activeGroupId}
            onValueChange={setActiveGroupId}
            disabled={groups.length === 0}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Choose group" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {activeGroup && activeGroupMembers.length === 0 && (
        <div className="px-5 py-2 border-b border-border" style={{ background: "var(--muted)" }}>
          <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
            Group membership roster is missing, so this view currently shows all available leaderboard profiles.
          </Mono>
        </div>
      )}

      {activeGroup && (
        <div className="px-5 py-3 border-b border-border">
          <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: "rgba(153,69,255,0.12)", border: "1px solid rgba(153,69,255,0.2)" }}
                >
                  <BarChart3 size={14} style={{ color: "#9945FF" }} />
                </div>
                <div className="min-w-0">
                  <p className="text-foreground" style={{ fontSize: "12px", fontWeight: 700 }}>
                    Bet history analytics
                  </p>
                  <p className="text-muted-foreground truncate" style={{ fontSize: "10px" }}>
                    {resolvedOutcomes.length} resolved bets across {historyBetIds.size} bet cards
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <div className="rounded-lg border border-border/70 bg-card px-2.5 py-2">
                <Mono className="text-muted-foreground block" style={{ fontSize: "9px" } as React.CSSProperties}>
                  MOST WINS
                </Mono>
                <p className="text-foreground mt-1 truncate" style={{ fontSize: "13px", fontWeight: 700 }}>
                  {topWinner ? `${topWinner.name} · ${topWinner.wins}` : "—"}
                </p>
                <Mono className="text-muted-foreground block" style={{ fontSize: "10px" } as React.CSSProperties}>
                  {topWinner ? `${topWinner.wins}W-${topWinner.losses}L record` : "No resolved bets yet"}
                </Mono>
              </div>

              <div className="rounded-lg border border-border/70 bg-card px-2.5 py-2">
                <Mono className="text-muted-foreground block" style={{ fontSize: "9px" } as React.CSSProperties}>
                  BEST WIN RATE
                </Mono>
                <p className="text-foreground mt-1 truncate" style={{ fontSize: "13px", fontWeight: 700 }}>
                  {highestWinRate ? `${highestWinRate.winRate.toFixed(0)}%` : "—"}
                </p>
                <Mono className="text-muted-foreground block truncate" style={{ fontSize: "10px" } as React.CSSProperties}>
                  {highestWinRate ? `${highestWinRate.name} · ${highestWinRate.resolved} bets` : "Need completed bets"}
                </Mono>
              </div>

              <div className="rounded-lg border border-border/70 bg-card px-2.5 py-2">
                <Mono className="text-muted-foreground block" style={{ fontSize: "9px" } as React.CSSProperties}>
                  NET WINNINGS ({displayCurrency})
                </Mono>
                <p
                  className="mt-1 truncate"
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: biggestNet
                      ? biggestNet.net > 0
                        ? "#14F195"
                        : biggestNet.net < 0
                          ? "#FF4A4A"
                          : "var(--foreground)"
                      : "var(--foreground)",
                  }}
                >
                  {biggestNet ? formatSignedStakeAmount(biggestNet.net, displayCurrency) : "—"}
                </p>
                <Mono className="text-muted-foreground block truncate" style={{ fontSize: "10px" } as React.CSSProperties}>
                  {biggestNet ? biggestNet.name : "No payout data yet"}
                </Mono>
              </div>
            </div>

            <div className="space-y-2">
              {betPerformance.length === 0 && (
                <Mono className="text-muted-foreground block" style={{ fontSize: "10px" } as React.CSSProperties}>
                  Resolve a few bets in chat to populate win-rate bars and payout totals.
                </Mono>
              )}

              {betPerformance.slice(0, 6).map((entry) => (
                <div key={`${activeGroup.id}-${entry.key}`} className="rounded-lg border border-border/70 bg-card px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar initials={entry.initials} size={24} />
                      <div className="min-w-0">
                        <p className="text-foreground truncate" style={{ fontSize: "11px", fontWeight: 600 }}>
                          {entry.name}
                        </p>
                        <Mono className="text-muted-foreground block truncate" style={{ fontSize: "9px" } as React.CSSProperties}>
                          @{entry.github}
                        </Mono>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <Mono className="text-foreground block" style={{ fontSize: "10px" } as React.CSSProperties}>
                        {entry.wins}W-{entry.losses}L · {entry.winRate.toFixed(0)}%
                      </Mono>
                      <Mono
                        className="block"
                        style={{
                          fontSize: "10px",
                          color: entry.net > 0 ? "#14F195" : entry.net < 0 ? "#FF4A4A" : "var(--muted-foreground)",
                        } as React.CSSProperties}
                      >
                        {formatSignedStakeAmount(entry.net, displayCurrency)}
                      </Mono>
                    </div>
                  </div>
                  <div className="mt-2">
                    <WinRateBar winRate={entry.winRate} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <div style={{ minWidth: 700 }}>
          {/* Column headers */}
          <div
            className="grid px-5 py-2 border-b border-border gap-3"
            style={{ gridTemplateColumns: "36px 1fr 130px 150px 210px" }}
          >
            {["Rank", "Player", "SOL Balance", "Net Change", "Bet Metrics"].map((header) => (
              <Mono key={header} className="text-muted-foreground uppercase" style={{ fontSize: "9px", letterSpacing: "0.1em" } as React.CSSProperties}>
                {header}
              </Mono>
            ))}
          </div>

          {/* Rows */}
          <div className="divide-y divide-border">
            {!activeGroup && (
              <div className="px-5 py-10 flex items-center justify-center">
                <Mono className="text-muted-foreground" style={{ fontSize: "11px" } as React.CSSProperties}>
                  Join a group chat to view group-specific rankings.
                </Mono>
              </div>
            )}
            {activeGroup && sorted.length === 0 && (
              <div className="px-5 py-10 flex items-center justify-center">
                <Mono className="text-muted-foreground" style={{ fontSize: "11px" } as React.CSSProperties}>
                  No leaderboard profiles available for this group yet.
                </Mono>
              </div>
            )}
            {activeGroup && sorted.length > 0 && (
              <AnimatePresence>
                {sorted.map((player, idx) => {
                  const isFirst = idx === 0;
                  const playerStats = betPerformanceByKey.get(normalizeHandle(player.github))
                    ?? betPerformanceByKey.get(normalizeHandle(player.name))
                    ?? null;
                  return (
                    <motion.div
                      key={`${activeGroup.id}-${player.github}`}
                      layout
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.22, delay: idx * 0.03 }}
                      className="grid items-center px-5 py-3.5 gap-3 group hover:bg-muted/30 transition-colors duration-100"
                      style={{
                        gridTemplateColumns: "36px 1fr 130px 150px 210px",
                        background: isFirst ? "rgba(255,184,0,0.04)" : undefined,
                      }}
                    >
                      {/* Rank */}
                      <div className="flex items-center justify-center">
                        <RankBadge rank={idx + 1} />
                      </div>

                      {/* Player */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar initials={player.initials} size={32} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-foreground truncate"
                              style={{ fontSize: "13px", fontWeight: 600 }}>
                              {player.name}
                            </span>
                            {player.streak >= 3 && (
                              <motion.span
                                animate={{ scale: [1, 1.12, 1] }}
                                transition={{ repeat: Infinity, duration: 2.5 }}
                                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md shrink-0"
                                style={{
                                  background: "rgba(255,74,74,0.12)",
                                  border: "1px solid rgba(255,74,74,0.2)",
                                  fontSize: "9px",
                                  fontFamily: "'JetBrains Mono', monospace",
                                  color: "#FF4A4A",
                                }}
                              >
                                <Flame size={8} /> {player.streak}
                              </motion.span>
                            )}
                          </div>
                          <a
                            href="#"
                            className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                            style={{ fontSize: "10px" }}
                          >
                            <Github size={9} />
                            <Mono style={{ fontSize: "10px" } as React.CSSProperties}>@{player.github}</Mono>
                          </a>
                        </div>
                      </div>

                      {/* Balance */}
                      <div>
                        <Mono className="text-foreground"
                          style={{ fontSize: "15px", fontWeight: 700 } as React.CSSProperties}>
                          {player.sol.toFixed(2)}
                        </Mono>
                        <Mono className="text-muted-foreground" style={{ fontSize: "9px" } as React.CSSProperties}>
                          SOL
                        </Mono>
                      </div>

                      {/* Delta */}
                      <Delta
                        value={player.solDelta}
                        unit="SOL"
                      />

                      {/* Bet metrics */}
                      <BetMetricsCell
                        stats={playerStats}
                        currency={displayCurrency}
                      />
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
