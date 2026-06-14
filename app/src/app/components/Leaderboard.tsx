import { Github, TrendingUp, TrendingDown, Minus, Trophy, Star, Zap } from "lucide-react";

interface Player {
  rank: number;
  name: string;
  initials: string;
  githubUsername: string;
  solBalance: number;
  solDelta: number;
  wins: number;
  total: number;
  streak: number;
}

const players: Player[] = [
  { rank: 1, name: "Sarah Chen", initials: "SC", githubUsername: "sarahcodes", solBalance: 2.41, solDelta: 0.8, wins: 18, total: 21, streak: 7 },
  { rank: 2, name: "Kevin Park", initials: "KP", githubUsername: "kev_dev", solBalance: 1.75, solDelta: 0.3, wins: 14, total: 18, streak: 3 },
  { rank: 3, name: "Jordan Lee", initials: "JL", githubUsername: "jleebuilds", solBalance: 1.22, solDelta: -0.15, wins: 11, total: 17, streak: 0 },
  { rank: 4, name: "Matt Rivera", initials: "MR", githubUsername: "matt_riv", solBalance: 0.98, solDelta: 0.4, wins: 9, total: 13, streak: 2 },
  { rank: 5, name: "Alex Kim", initials: "AK", githubUsername: "alexbuilds", solBalance: 0.64, solDelta: -0.05, wins: 7, total: 12, streak: 0 },
  { rank: 6, name: "Dana Wu", initials: "DW", githubUsername: "danawu_dev", solBalance: 0.38, solDelta: 0.1, wins: 5, total: 10, streak: 1 },
  { rank: 7, name: "Chris Obi", initials: "CO", githubUsername: "chrisobi", solBalance: 0.21, solDelta: -0.02, wins: 3, total: 9, streak: 0 },
];

const avatarColors: Record<number, string> = {
  1: "bg-[#FFB800]/20 text-[#FFB800]",
  2: "bg-[#9945FF]/20 text-[#9945FF]",
  3: "bg-[#14F195]/20 text-[#14F195]",
  4: "bg-blue-500/20 text-blue-400",
  5: "bg-pink-500/20 text-pink-400",
  6: "bg-orange-500/20 text-orange-400",
  7: "bg-cyan-500/20 text-cyan-400",
};

function DeltaCell({ value }: { value: number }) {
  const positive = value > 0;
  const zero = value === 0;
  return (
    <div className={`flex items-center gap-1 justify-end ${
      zero ? "text-muted-foreground" : positive ? "text-[#14F195]" : "text-[#FF4A4A]"
    }`} style={{ fontSize: "13px", fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}>
      {zero ? <Minus size={12} /> : positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {zero ? "—" : `${positive ? "+" : ""}${value.toFixed(2)} SOL`}
    </div>
  );
}

function PerformanceBar({ wins, total }: { wins: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((wins / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: pct >= 70 ? "#14F195" : pct >= 40 ? "#FFB800" : "#FF4A4A",
          }}
        />
      </div>
      <span className="text-muted-foreground shrink-0" style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" }}>
        {wins}/{total} · {pct}%
      </span>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy size={16} className="text-[#FFB800]" />;
  if (rank === 2) return <Star size={15} className="text-[#8A99AD]" />;
  if (rank === 3) return <Star size={15} className="text-[#CD7F32]" />;
  return (
    <span className="text-muted-foreground" style={{ fontSize: "13px", fontFamily: "'JetBrains Mono', monospace" }}>
      #{rank}
    </span>
  );
}

export function Leaderboard() {
  const sorted = [...players].sort((a, b) => b.solBalance - a.solBalance);
  const poolTotal = sorted.reduce((sum, player) => sum + player.solBalance, 0);

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div>
          <p className="text-foreground" style={{ fontSize: "16px", fontWeight: 700 }}>Live Leaderboard</p>
          <p className="text-muted-foreground" style={{ fontSize: "12px" }}>Updated in real-time · 7 players</p>
        </div>
        <div className="px-3 py-1.5 rounded-md border border-border bg-muted/50 text-foreground" style={{ fontSize: "12px", fontWeight: 500 }}>
          SOL Wager Pool
        </div>
      </div>

      {/* Column headers */}
      <div className="grid px-5 py-2 border-b border-border"
        style={{ gridTemplateColumns: "40px 1fr 160px 200px 1fr" }}>
        {["Rank", "Player", "SOL Balance", "Net Change", "Win Rate"].map((h) => (
          <span key={h} className="text-muted-foreground uppercase tracking-widest"
            style={{ fontSize: "9px", fontFamily: "'JetBrains Mono', monospace" }}>
            {h}
          </span>
        ))}
      </div>

      {/* Rows */}
      <div className="divide-y divide-border">
        {sorted.map((player, idx) => (
          <div
            key={player.name}
            className={`grid items-center px-5 py-3.5 hover:bg-muted/30 transition-colors ${
              idx === 0 ? "bg-[#FFB800]/5" : ""
            }`}
            style={{ gridTemplateColumns: "40px 1fr 160px 200px 1fr" }}
          >
            {/* Rank */}
            <div className="flex items-center justify-center w-8">
              <RankBadge rank={idx + 1} />
            </div>

            {/* Player */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${avatarColors[idx + 1]}`}>
                {player.initials}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-foreground truncate" style={{ fontSize: "13px", fontWeight: 600 }}>
                    {player.name}
                  </p>
                  {player.streak >= 3 && (
                    <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#FF4A4A]/10 text-[#FF4A4A] border border-[#FF4A4A]/20"
                      style={{ fontSize: "9px", fontFamily: "'JetBrains Mono', monospace" }}>
                      <Zap size={8} />
                      {player.streak}
                    </span>
                  )}
                </div>
                <a
                  href="#"
                  className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                  style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" }}
                >
                  <Github size={10} />
                  @{player.githubUsername}
                </a>
              </div>
            </div>

            {/* Balance */}
            <div>
              <p className="text-foreground" style={{ fontSize: "15px", fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                {player.solBalance.toFixed(2)}
              </p>
              <p className="text-muted-foreground" style={{ fontSize: "10px", fontFamily: "'JetBrains Mono', monospace" }}>
                SOL
              </p>
            </div>

            {/* Net Change */}
            <DeltaCell value={player.solDelta} />

            {/* Win Rate */}
            <PerformanceBar wins={player.wins} total={player.total} />
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-border flex items-center justify-between bg-muted/20">
        <p className="text-muted-foreground" style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" }}>
          POOL_TOTAL: {poolTotal.toFixed(2)} SOL
        </p>
        <p className="text-muted-foreground" style={{ fontSize: "11px" }}>
          Last updated: just now
        </p>
      </div>
    </div>
  );
}
