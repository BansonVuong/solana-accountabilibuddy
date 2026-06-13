import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Lock, CheckCircle2, Clock, ChevronRight, Shield, Zap, AlertTriangle } from "lucide-react";
import { Avatar, Pill, Card, Mono } from "./ui";

/* ── Types ─────────────────────────────────────────────── */
type Mode = "WAGER" | "FREE";

interface WitnessData {
  id:          string;
  initials:    string;
  name:        string;
  hasVoted:    boolean;
  votedForId?: "challenger" | "acceptor";
}

/* ── Fixtures ──────────────────────────────────────────── */
const WITNESSES: WitnessData[] = [
  { id: "w1", initials: "JD", name: "Jordan", hasVoted: true, votedForId: "challenger" },
  { id: "w2", initials: "SR", name: "Sarah",  hasVoted: false },
  { id: "w3", initials: "KP", name: "Kevin",  hasVoted: false },
];

/* ── Wallet pill ───────────────────────────────────────── */
function WalletPill({
  name, address, role, accent,
}: { name: string; address: string; role: string; accent: string }) {
  return (
    <div className="flex items-center gap-2">
      <Avatar initials={name.slice(0, 2).toUpperCase()} size={28} />
      <div>
        <p className="text-foreground" style={{ fontSize: "13px", fontWeight: 700 }}>{name}</p>
        <p className="flex items-center gap-1" style={{ fontSize: "10px", color: accent }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{address}</span>
          <span className="text-muted-foreground">· {role}</span>
        </p>
      </div>
    </div>
  );
}

/* ── Stake panel ───────────────────────────────────────── */
function ChallengerPanel({ stake, currency, mode }: { stake: string; currency: string; mode: Mode }) {
  return (
    <div
      className="flex-1 rounded-2xl p-5 border flex flex-col gap-4"
      style={{
        background: "rgba(153,69,255,0.06)",
        borderColor: "rgba(153,69,255,0.2)",
      }}
    >
      <WalletPill
        name="Alice"
        address="9xMF…kR4p"
        role="Challenger"
        accent="#9945FF"
      />

      <div className="flex flex-col items-center py-4 gap-2">
        <p
          className="tracking-tight"
          style={{
            fontSize: "40px",
            fontWeight: 800,
            color: "#9945FF",
            fontFamily: "'Inter', sans-serif",
            letterSpacing: "-0.02em",
          }}
        >
          {mode === "WAGER" ? stake : "FREE"}
        </p>
        <Mono className="text-muted-foreground" style={{ fontSize: "11px" } as React.CSSProperties}>
          {mode === "WAGER" ? currency : "NO STAKE · FREE MODE"}
        </Mono>
      </div>

      <div
        className="flex items-center justify-center gap-2 py-2.5 rounded-xl"
        style={{
          background: "rgba(153,69,255,0.1)",
          border: "1px solid rgba(153,69,255,0.2)",
        }}
      >
        <Lock size={12} style={{ color: "#9945FF" }} />
        <Mono style={{ fontSize: "11px", color: "#9945FF" } as React.CSSProperties}>
          LOCKED · IN ESCROW
        </Mono>
      </div>
    </div>
  );
}

function AcceptorPanel({ stake, currency, mode }: { stake: string; currency: string; mode: Mode }) {
  const [accepted, setAccepted] = useState(false);

  return (
    <div
      className="flex-1 rounded-2xl p-5 border flex flex-col gap-4 transition-all duration-300"
      style={{
        background: accepted ? "rgba(20,241,149,0.05)" : "rgba(20,241,149,0.04)",
        borderColor: accepted ? "rgba(20,241,149,0.3)" : "rgba(20,241,149,0.15)",
        boxShadow: accepted ? "0 0 20px rgba(20,241,149,0.08)" : "none",
      }}
    >
      <WalletPill
        name="Bob"
        address="3dQW…nZ7x"
        role="Acceptor"
        accent="#14F195"
      />

      <div className="flex flex-col items-center py-4 gap-2">
        <p
          className="tracking-tight"
          style={{
            fontSize: "40px",
            fontWeight: 800,
            color: accepted ? "#14F195" : "var(--muted-foreground)",
            fontFamily: "'Inter', sans-serif",
            letterSpacing: "-0.02em",
            transition: "color 0.3s",
          }}
        >
          {mode === "WAGER" ? stake : "FREE"}
        </p>
        <Mono className="text-muted-foreground" style={{ fontSize: "11px" } as React.CSSProperties}>
          {mode === "WAGER" ? currency : "NO STAKE · FREE MODE"}
        </Mono>
      </div>

      <AnimatePresence mode="wait">
        {accepted ? (
          <motion.div
            key="locked"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="flex items-center justify-center gap-2 py-2.5 rounded-xl"
            style={{
              background: "rgba(20,241,149,0.1)",
              border: "1px solid rgba(20,241,149,0.3)",
            }}
          >
            <CheckCircle2 size={12} style={{ color: "#14F195" }} />
            <Mono style={{ fontSize: "11px", color: "#14F195" } as React.CSSProperties}>
              ACTIVE · LOCKED IN ESCROW
            </Mono>
          </motion.div>
        ) : (
          <motion.button
            key="accept"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => setAccepted(true)}
            className="relative w-full py-2.5 rounded-xl overflow-hidden"
            style={{
              background: "rgba(20,241,149,0.1)",
              border: "1.5px solid rgba(20,241,149,0.35)",
            }}
          >
            {/* Neon glow pulse */}
            <motion.span
              className="absolute inset-0 rounded-xl"
              animate={{ opacity: [0.4, 0.9, 0.4] }}
              transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
              style={{ boxShadow: "0 0 16px rgba(20,241,149,0.3)" }}
            />
            <span className="relative flex items-center justify-center gap-2" style={{ color: "#14F195" }}>
              <Mono style={{ fontSize: "12px" } as React.CSSProperties}>
                DEPOSIT STAKE TO ACCEPT
              </Mono>
              <ChevronRight size={12} />
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Witness tray ──────────────────────────────────────── */
function WitnessNode({ w }: { w: WitnessData }) {
  const ringColor = w.hasVoted
    ? w.votedForId === "challenger" ? "#9945FF" : "#14F195"
    : "var(--border)";
  const label = w.hasVoted
    ? `VOTED: ${w.votedForId === "challenger" ? "ALICE" : "BOB"}`
    : "HAS_VOTED: FALSE";
  const pillColor = w.hasVoted
    ? w.votedForId === "challenger" ? "purple" : "teal"
    : "muted";

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="rounded-full p-0.5 transition-all duration-300"
        style={{
          background: w.hasVoted
            ? w.votedForId === "challenger"
              ? "linear-gradient(135deg, rgba(153,69,255,0.3), rgba(153,69,255,0.1))"
              : "linear-gradient(135deg, rgba(20,241,149,0.3), rgba(20,241,149,0.1))"
            : "transparent",
          boxShadow: w.hasVoted
            ? w.votedForId === "challenger"
              ? "0 0 12px rgba(153,69,255,0.35)"
              : "0 0 12px rgba(20,241,149,0.35)"
            : "none",
          border: `2px solid ${ringColor}`,
          borderRadius: "9999px",
        }}
      >
        <Avatar initials={w.initials} size={38} />
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="text-foreground" style={{ fontSize: "11px", fontWeight: 600 }}>{w.name}</span>
        <Pill color={pillColor as "purple" | "teal" | "muted"} className="text-[9px]">
          {label}
        </Pill>
      </div>
    </div>
  );
}

/* ── Main view ─────────────────────────────────────────── */
export function EscrowView() {
  const [mode, setMode] = useState<Mode>("WAGER");

  const votedCount  = WITNESSES.filter(w => w.hasVoted).length;
  const quorumPct   = Math.round((votedCount / WITNESSES.length) * 100);

  return (
    <div className="max-w-2xl mx-auto space-y-4">

      {/* ── Bet header card ─────────────────────────── */}
      <Card>
        <div className="px-5 pt-5 pb-4">

          {/* Top badges */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <Pill color={mode === "WAGER" ? "purple" : "teal"}>
              <Shield size={8} />
              {mode === "WAGER" ? "WAGER MODE · P2P" : "FREE MODE · P2P"}
            </Pill>
            <Pill color="amber">
              <Clock size={8} />
              AWAITING ACCEPTANCE
            </Pill>
            {/* Mode toggle */}
            <div className="ml-auto flex items-center gap-1 p-1 rounded-lg"
              style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
              {(["WAGER", "FREE"] as Mode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className="px-2.5 py-1 rounded-md transition-all"
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    fontFamily: "'JetBrains Mono', monospace",
                    background: mode === m ? "var(--primary)" : "transparent",
                    color: mode === m ? "#fff" : "var(--muted-foreground)",
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Terms */}
          <p className="text-foreground leading-snug"
            style={{ fontSize: "20px", fontWeight: 700, letterSpacing: "-0.01em" }}>
            Alice wagers Bob that Bob cannot ship a working full-stack feature before EOD Friday
          </p>

          {/* Meta row */}
          <div className="flex items-center gap-4 mt-3">
            <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
              BET_ID: #AB-0042
            </Mono>
            <span className="text-border">·</span>
            <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
              CREATED: 3h ago
            </Mono>
            <span className="text-border">·</span>
            <Mono style={{ fontSize: "10px", color: "#FFB800" } as React.CSSProperties}>
              EXPIRES: 21h 38m
            </Mono>
          </div>
        </div>
      </Card>

      {/* ── Split escrow panels ──────────────────────── */}
      <div className="flex gap-3">
        <ChallengerPanel
          stake={mode === "WAGER" ? "5,000 POINTS" : "—"}
          currency="$PALS ECONOMY"
          mode={mode}
        />
        <AcceptorPanel
          stake={mode === "WAGER" ? "5,000 POINTS" : "—"}
          currency="$PALS ECONOMY"
          mode={mode}
        />
      </div>

      {/* ── Witness tray ─────────────────────────────── */}
      <Card>
        <div className="px-5 py-4">

          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-foreground" style={{ fontSize: "13px", fontWeight: 700 }}>
                Witness Panel
              </p>
              <p className="text-muted-foreground" style={{ fontSize: "11px" }}>
                {votedCount} of {WITNESSES.length} votes cast · quorum requires 2 of {WITNESSES.length}
              </p>
            </div>
            <Pill color={votedCount >= 2 ? "teal" : "amber"}>
              {votedCount >= 2 ? <CheckCircle2 size={8} /> : <AlertTriangle size={8} />}
              {votedCount >= 2 ? "QUORUM REACHED" : `QUORUM: ${votedCount}/${WITNESSES.length}`}
            </Pill>
          </div>

          <div className="flex items-start justify-center gap-10">
            {WITNESSES.map(w => <WitnessNode key={w.id} w={w} />)}
          </div>

          {/* Progress bar */}
          <div className="mt-5 flex items-center gap-3">
            <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
              <motion.div
                className="h-full rounded-full"
                initial={{ width: "0%" }}
                animate={{ width: `${quorumPct}%` }}
                transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
                style={{
                  background: quorumPct >= 67
                    ? "linear-gradient(90deg, #9945FF, #14F195)"
                    : "linear-gradient(90deg, #9945FF, #9945FFcc)",
                }}
              />
            </div>
            <Mono className="text-muted-foreground shrink-0" style={{ fontSize: "10px" } as React.CSSProperties}>
              {quorumPct}% voted
            </Mono>
          </div>
        </div>
      </Card>
    </div>
  );
}
