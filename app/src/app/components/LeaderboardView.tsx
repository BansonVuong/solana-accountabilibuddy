import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Github, TrendingUp, TrendingDown, Minus, Trophy, Flame, Star, Activity } from "lucide-react";
import { Avatar, Card, Mono } from "./ui";
import {
  getGroups,
  getLeaderboard,
  getProfiles,
  type Group,
  type Player as RelayerPlayer,
  type Profile,
} from "../../lib/relayer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

/* ── Types & data ──────────────────────────────────────── */
type Tab = "points" | "sol";

interface Player {
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
  /** Placeholder until Mongo stores per-user bet volume for leaderboard views. */
  betCount: number | null;
  /** Placeholder until Mongo stores per-user completion rate for leaderboard views. */
  completionRate: number | null;
}

function toOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fromProfile(profile: Profile, rank: number): Player {
  return {
    rank,
    name: profile.name,
    initials: profile.initials,
    github: profile.github,
    pals: profile.pals,
    palsDelta: 0,
    sol: profile.sol,
    solDelta: 0,
    wins: profile.wins,
    disputes: profile.disputes,
    streak: profile.streak,
    streakDir: profile.streakDir,
    betCount: toOptionalNumber(profile.betCount),
    completionRate: toOptionalNumber(profile.completionRate),
  };
}

function fromRelayerPlayer(player: RelayerPlayer, rank: number): Player {
  return {
    rank,
    name: player.name,
    initials: player.initials,
    github: player.github,
    pals: player.pals,
    palsDelta: player.palsDelta,
    sol: player.sol,
    solDelta: player.solDelta,
    wins: player.wins,
    disputes: player.disputes,
    streak: player.streak,
    streakDir: player.streakDir,
    betCount: toOptionalNumber(player.betCount),
    completionRate: toOptionalNumber(player.completionRate),
  };
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

/* ── Future metrics placeholder cell ───────────────────── */
function BetMetricsCell({
  betCount,
  completionRate,
}: {
  betCount: number | null;
  completionRate: number | null;
}) {
  const hasBetCount = typeof betCount === "number";
  const hasCompletionRate = typeof completionRate === "number";
  return (
    <div className="space-y-0.5">
      <Mono className="text-foreground block" style={{ fontSize: "10px" } as React.CSSProperties}>
        {hasBetCount ? `${betCount.toLocaleString()} bets` : "Bets: pending data"}
      </Mono>
      <Mono className="text-muted-foreground block" style={{ fontSize: "10px" } as React.CSSProperties}>
        {hasCompletionRate ? `${completionRate.toFixed(1)}% completion` : "Completion rate: pending data"}
      </Mono>
    </div>
  );
}

/* ── Main view ─────────────────────────────────────────── */
export function LeaderboardView() {
  const [tab, setTab] = useState<Tab>("points");
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState("");

  const [players, setPlayers] = useState<Player[]>([]);
  const [playersLive, setPlayersLive] = useState(false);
  const [groupsLive, setGroupsLive] = useState(false);

  useEffect(() => {
    let alive = true;

    const load = async (): Promise<void> => {
      const [groupsResult, profilesResult] = await Promise.allSettled([
        getGroups(),
        getProfiles(),
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

      if (profilesResult.status === "fulfilled" && profilesResult.value.profiles.length) {
        const mapped = [...profilesResult.value.profiles]
          .sort((a, b) => b.pals - a.pals)
          .map((profile, index) => fromProfile(profile, index + 1));
        setPlayers(mapped);
        setPlayersLive(true);
        return;
      }

      try {
        const { players: relayerPlayers } = await getLeaderboard();
        if (!alive) return;
        if (relayerPlayers.length) {
          setPlayers(relayerPlayers.map((player, index) => fromRelayerPlayer(player, index + 1)));
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
    }, 30_000);

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

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
      const github = player.github.trim().replace(/^@/, "").toLowerCase();
      const name = player.name.trim().toLowerCase();
      return members.has(github) || members.has(name);
    });
  }, [activeGroup, activeGroupMembers, players]);

  const sorted = useMemo(
    () => [...groupPlayers].sort((a, b) =>
      tab === "points" ? b.pals - a.pals : b.sol - a.sol
    ),
    [groupPlayers, tab],
  );

  const poolTotal = useMemo(
    () => tab === "points"
      ? `${groupPlayers.reduce((sum, player) => sum + player.pals, 0).toLocaleString()} $PALS`
      : `${groupPlayers.reduce((sum, player) => sum + player.sol, 0).toFixed(2)} SOL`,
    [groupPlayers, tab],
  );

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
            <p className="text-foreground" style={{ fontSize: "15px", fontWeight: 700 }}>Group Leaderboard</p>
            <p className="text-muted-foreground" style={{ fontSize: "11px" }}>
              {activeGroup
                ? `${sorted.length} players in ${activeGroup.name} · ${playersLive ? "live from MongoDB" : "waiting for live data"}`
                : groups.length
                  ? "Select a group to view its leaderboard"
                  : groupsLive
                    ? "No groups joined yet"
                    : "waiting for group data"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-56">
            <Select
              value={activeGroupId}
              onValueChange={setActiveGroupId}
              disabled={groups.length === 0}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select your group" />
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

          {/* Toggle */}
          <div className="flex items-center gap-1 p-1 rounded-xl border border-border"
            style={{ background: "var(--muted)" }}>
            {([
              { key: "points", label: "$PALS Points" },
              { key: "sol", label: "SOL Wager Pool" },
            ] as { key: Tab; label: string }[]).map((entry) => (
              <motion.button
                key={entry.key}
                whileTap={{ scale: 0.95 }}
                onClick={() => setTab(entry.key)}
                className="relative px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
                style={{
                  color: tab === entry.key ? "var(--primary-foreground)" : "var(--muted-foreground)",
                }}
              >
                {tab === entry.key && (
                  <motion.span
                    layoutId="tab-bg"
                    className="absolute inset-0 rounded-lg"
                    style={{ background: "var(--primary)" }}
                    transition={{ type: "spring", duration: 0.35, bounce: 0.15 }}
                  />
                )}
                <span className="relative">{entry.label}</span>
              </motion.button>
            ))}
          </div>
        </div>
      </div>

      {activeGroup && activeGroupMembers.length === 0 && (
        <div className="px-5 py-2 border-b border-border" style={{ background: "var(--muted)" }}>
          <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
            Group membership roster is missing, so this view currently shows all available leaderboard profiles.
          </Mono>
        </div>
      )}

      {/* Column headers */}
      <div
        className="grid px-5 py-2 border-b border-border gap-3"
        style={{ gridTemplateColumns: "36px 1fr 140px 160px 220px" }}
      >
        {["Rank", "Player", tab === "points" ? "$PALS Balance" : "SOL Balance", "Net Change", "Bet Activity"].map((header) => (
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
                    gridTemplateColumns: "36px 1fr 140px 160px 220px",
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
                      {tab === "points"
                        ? player.pals.toLocaleString()
                        : player.sol.toFixed(2)}
                    </Mono>
                    <Mono className="text-muted-foreground" style={{ fontSize: "9px" } as React.CSSProperties}>
                      {tab === "points" ? "$PALS" : "SOL"}
                    </Mono>
                  </div>

                  {/* Delta */}
                  <Delta
                    value={tab === "points" ? player.palsDelta : player.solDelta}
                    unit={tab === "points" ? "PALS" : "SOL"}
                  />

                  {/* Future metric placeholders */}
                  <BetMetricsCell
                    betCount={player.betCount}
                    completionRate={player.completionRate}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* Footer */}
      <div
        className="px-5 py-3 border-t border-border flex items-center justify-between"
        style={{ background: "var(--muted)" }}
      >
        <div className="flex items-center gap-1.5">
          <Activity size={11} className="text-muted-foreground" />
          <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
            POOL TOTAL: {poolTotal}
          </Mono>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full inline-block animate-pulse" style={{ background: "#14F195" }} />
          <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
            LIVE · refreshes every 30s
          </Mono>
        </div>
      </div>
    </Card>
  );
}
