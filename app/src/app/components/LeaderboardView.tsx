import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Github, TrendingUp, TrendingDown, Minus, Trophy, Flame, Star, Activity } from "lucide-react";
import { Avatar, Pill, Card, Mono } from "./ui";
import { getLeaderboard } from "../../lib/relayer";

/* ── Types & data ──────────────────────────────────────── */
type Tab = "points" | "sol";

interface Player {
  rank:          number;
  name:          string;
  initials:      string;
  github:        string;
  pals:          number;
  palsDelta:     number;
  sol:           number;
  solDelta:      number;
  wins:          number;
  disputes:      number;
  streak:        number;
  streakDir:     "up" | "down" | "neutral";
}

const PLAYERS: Player[] = [
  { rank:1, name:"Sarah Chen",   initials:"SC", github:"sarahcodes",   pals:12450, palsDelta:+1200, sol:2.41, solDelta:+0.80, wins:18, disputes:21, streak:7,  streakDir:"up"     },
  { rank:2, name:"Kevin Park",   initials:"KP", github:"kev_dev",      pals:9820,  palsDelta:+540,  sol:1.75, solDelta:+0.30, wins:14, disputes:18, streak:3,  streakDir:"up"     },
  { rank:3, name:"Jordan Lee",   initials:"JL", github:"jleebuilds",   pals:8110,  palsDelta:-320,  sol:1.22, solDelta:-0.15, wins:11, disputes:17, streak:0,  streakDir:"neutral"},
  { rank:4, name:"Matt Rivera",  initials:"MR", github:"matt_riv",     pals:7340,  palsDelta:+860,  sol:0.98, solDelta:+0.40, wins:9,  disputes:13, streak:2,  streakDir:"up"     },
  { rank:5, name:"Alex Kim",     initials:"AK", github:"alexbuilds",   pals:5900,  palsDelta:-150,  sol:0.64, solDelta:-0.05, wins:7,  disputes:12, streak:0,  streakDir:"neutral"},
  { rank:6, name:"Dana Wu",      initials:"DW", github:"danawu_dev",   pals:4200,  palsDelta:+210,  sol:0.38, solDelta:+0.10, wins:5,  disputes:10, streak:1,  streakDir:"up"     },
  { rank:7, name:"Chris Obi",    initials:"CO", github:"chrisobi",     pals:2750,  palsDelta:-80,   sol:0.21, solDelta:-0.02, wins:3,  disputes:9,  streak:0,  streakDir:"down"   },
];

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

/* ── Win-rate bar ──────────────────────────────────────── */
function WinBar({ wins, total }: { wins: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((wins / total) * 100);
  const barColor =
    pct >= 70 ? "#14F195" :
    pct >= 45 ? "#FFB800" : "#FF4A4A";

  return (
    <div className="flex items-center gap-2.5">
      <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
        <motion.div
          className="h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.1 }}
          style={{ background: barColor }}
        />
      </div>
      <Mono className="text-muted-foreground shrink-0" style={{ fontSize: "10px" } as React.CSSProperties}>
        {wins}/{total} · {pct}%
      </Mono>
    </div>
  );
}

/* ── Main view ─────────────────────────────────────────── */
export function LeaderboardView() {
  const [tab, setTab] = useState<Tab>("points");

  // Live from the relayer (Mongo-backed) when available; design fixtures otherwise.
  const [players, setPlayers] = useState<Player[]>(PLAYERS);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let alive = true;
    getLeaderboard()
      .then(({ players }) => {
        if (alive && players.length) { setPlayers(players as Player[]); setLive(true); }
      })
      .catch(() => { /* relayer offline or DB unconfigured — keep fixtures */ });
    return () => { alive = false; };
  }, []);

  const sorted = [...players].sort((a, b) =>
    tab === "points" ? b.pals - a.pals : b.sol - a.sol
  );

  const poolTotal = tab === "points"
    ? players.reduce((s, p) => s + p.pals, 0).toLocaleString() + " $PALS"
    : players.reduce((s, p) => s + p.sol, 0).toFixed(2) + " SOL";

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
            <p className="text-foreground" style={{ fontSize: "15px", fontWeight: 700 }}>Live Leaderboard</p>
            <p className="text-muted-foreground" style={{ fontSize: "11px" }}>
              {players.length} players · {live ? "live from chain relayer" : "demo data"}
            </p>
          </div>
        </div>

        {/* Toggle */}
        <div className="flex items-center gap-1 p-1 rounded-xl border border-border"
          style={{ background: "var(--muted)" }}>
          {([
            { key: "points", label: "$PALS Points" },
            { key: "sol",    label: "SOL Wager Pool" },
          ] as { key: Tab; label: string }[]).map(t => (
            <motion.button
              key={t.key}
              whileTap={{ scale: 0.95 }}
              onClick={() => setTab(t.key)}
              className="relative px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
              style={{
                color: tab === t.key ? "var(--primary-foreground)" : "var(--muted-foreground)",
              }}
            >
              {tab === t.key && (
                <motion.span
                  layoutId="tab-bg"
                  className="absolute inset-0 rounded-lg"
                  style={{ background: "var(--primary)" }}
                  transition={{ type: "spring", duration: 0.35, bounce: 0.15 }}
                />
              )}
              <span className="relative">{t.label}</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Column headers */}
      <div
        className="grid px-5 py-2 border-b border-border gap-3"
        style={{ gridTemplateColumns: "36px 1fr 140px 160px 1fr" }}
      >
        {["Rank", "Player", tab === "points" ? "$PALS Balance" : "SOL Balance", "Net Change", "Win Rate"].map(h => (
          <Mono key={h} className="text-muted-foreground uppercase" style={{ fontSize: "9px", letterSpacing: "0.1em" } as React.CSSProperties}>
            {h}
          </Mono>
        ))}
      </div>

      {/* Rows */}
      <div className="divide-y divide-border">
        <AnimatePresence>
          {sorted.map((player, idx) => {
            const isFirst = idx === 0;
            return (
              <motion.div
                key={player.name}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, delay: idx * 0.03 }}
                className="grid items-center px-5 py-3.5 gap-3 group hover:bg-muted/30 transition-colors duration-100"
                style={{
                  gridTemplateColumns: "36px 1fr 140px 160px 1fr",
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

                {/* Win rate */}
                <WinBar wins={player.wins} total={player.disputes} />
              </motion.div>
            );
          })}
        </AnimatePresence>
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
