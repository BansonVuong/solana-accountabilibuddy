import { useState } from "react";
import { Lock, CheckCircle2, Clock, ChevronRight, Zap, Shield, AlertCircle } from "lucide-react";
import { motion } from "motion/react";

interface Witness {
  id: string;
  initials: string;
  hasVoted: boolean;
  votedForId?: "challenger" | "acceptor";
}

const witnesses: Witness[] = [
  { id: "w1", initials: "JD", hasVoted: true, votedForId: "challenger" },
  { id: "w2", initials: "SR", hasVoted: false },
  { id: "w3", initials: "KV", hasVoted: false },
];

function WalletPill({ name, address, balance, side }: {
  name: string; address: string; balance: string; side: "challenger" | "acceptor";
}) {
  const isChallenger = side === "challenger";
  return (
    <div className={`px-1 py-1 rounded-full flex items-center gap-2 border ${
      isChallenger
        ? "bg-[#9945FF]/10 border-[#9945FF]/30"
        : "bg-[#14F195]/10 border-[#14F195]/30"
    }`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold ${
        isChallenger ? "bg-[#9945FF]/20 text-[#9945FF]" : "bg-[#14F195]/20 text-[#14F195]"
      }`}>
        {name.slice(0, 2).toUpperCase()}
      </div>
      <div className="pr-2">
        <p className="text-foreground" style={{ fontSize: "12px", fontWeight: 600 }}>{name}</p>
        <p className="text-muted-foreground" style={{ fontSize: "10px", fontFamily: "'JetBrains Mono', monospace" }}>
          {address.slice(0, 4)}…{address.slice(-4)}
        </p>
      </div>
    </div>
  );
}

function StakeDisplay({ amount, currency, side }: { amount: string; currency: string; side: "challenger" | "acceptor" }) {
  const isChallenger = side === "challenger";
  return (
    <div className={`rounded-2xl border p-5 ${
      isChallenger ? "border-[#9945FF]/20 bg-[#9945FF]/5" : "border-[#14F195]/20 bg-[#14F195]/5"
    }`}>
      <div className="mb-3 flex items-center justify-between">
        <WalletPill
          name={isChallenger ? "Alice" : "Bob"}
          address={isChallenger ? "9xMF...kR4p" : "3dQW...nZ7x"}
          balance={amount}
          side={side}
        />
        {isChallenger && (
          <span className="text-muted-foreground" style={{ fontSize: "11px" }}>Challenger</span>
        )}
        {!isChallenger && (
          <span className="text-muted-foreground" style={{ fontSize: "11px" }}>Acceptor</span>
        )}
      </div>

      <div className="text-center py-4">
        <p className={`${isChallenger ? "text-[#9945FF]" : "text-[#14F195]"}`}
          style={{ fontSize: "32px", fontWeight: 700, letterSpacing: "-0.5px", fontFamily: "'Inter', sans-serif" }}>
          {amount}
        </p>
        <p className="text-muted-foreground mt-1" style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" }}>
          {currency}
        </p>
      </div>

      {isChallenger ? (
        <div className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#9945FF]/10 border border-[#9945FF]/20">
          <Lock size={11} className="text-[#9945FF]" />
          <span className="text-[#9945FF]" style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}>
            LOCKED IN ESCROW
          </span>
        </div>
      ) : (
        <AcceptButton />
      )}
    </div>
  );
}

function AcceptButton() {
  const [accepted, setAccepted] = useState(false);

  if (accepted) {
    return (
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#14F195]/10 border border-[#14F195]/30"
      >
        <CheckCircle2 size={13} className="text-[#14F195]" />
        <span className="text-[#14F195]" style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
          ACTIVE / LOCKED IN ESCROW
        </span>
      </motion.div>
    );
  }

  return (
    <button
      onClick={() => setAccepted(true)}
      className="w-full py-2.5 rounded-lg border font-semibold transition-all duration-200
        border-[#14F195]/40 text-[#14F195] hover:bg-[#14F195]/10 relative overflow-hidden group"
      style={{ fontSize: "12px", fontFamily: "'JetBrains Mono', monospace" }}
    >
      <span className="relative z-10 flex items-center justify-center gap-1.5">
        DEPOSIT STAKE TO ACCEPT
        <ChevronRight size={12} />
      </span>
      <span className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ boxShadow: "0 0 16px 2px #14F19540" }} />
    </button>
  );
}

function WitnessAvatar({ witness, challengerInitials, acceptorInitials }: {
  witness: Witness; challengerInitials: string; acceptorInitials: string;
}) {
  const borderColor = witness.hasVoted
    ? witness.votedForId === "challenger" ? "border-[#9945FF]" : "border-[#14F195]"
    : "border-border";
  const bgColor = witness.hasVoted
    ? witness.votedForId === "challenger" ? "bg-[#9945FF]/20 text-[#9945FF]" : "bg-[#14F195]/20 text-[#14F195]"
    : "bg-muted text-muted-foreground";

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className={`w-9 h-9 rounded-full border-2 ${borderColor} ${bgColor} flex items-center justify-center text-[11px] font-semibold transition-all`}>
        {witness.initials}
      </div>
      <div className={`px-2 py-0.5 rounded-full border text-[9px] font-medium ${
        witness.hasVoted
          ? "bg-[#14F195]/10 border-[#14F195]/30 text-[#14F195]"
          : "bg-muted/50 border-border text-muted-foreground"
      }`} style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        {witness.hasVoted ? `VOTED: ${witness.votedForId === "challenger" ? challengerInitials : acceptorInitials}` : "hasVoted: false"}
      </div>
    </div>
  );
}

export function EscrowBetCard() {
  return (
    <div className="space-y-4">
      {/* Bet terms header */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold tracking-widest uppercase
            bg-[#9945FF]/10 text-[#9945FF] border border-[#9945FF]/20"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            <Shield size={9} />
            P2P · WAGER MODE
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border
            bg-[#FFB800]/10 text-[#FFB800] border-[#FFB800]/20"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            <Clock size={9} />
            AWAITING ACCEPTANCE
          </span>
        </div>
        <p className="text-foreground" style={{ fontSize: "20px", fontWeight: 700, lineHeight: "1.3" }}>
          Alice wagers Bob that Bob cannot ship a full-stack feature by end of week
        </p>
        <div className="mt-3 flex items-center gap-3 text-muted-foreground" style={{ fontSize: "12px" }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>bet_id: #AB-0042</span>
          <span>·</span>
          <span>Created 3 hours ago</span>
          <span>·</span>
          <span>Expires in 21h 42m</span>
        </div>
      </div>

      {/* Split panel */}
      <div className="grid grid-cols-2 gap-3">
        <StakeDisplay amount="0.50 SOL" currency="SOL" side="challenger" />
        <StakeDisplay amount="0.50 SOL" currency="SOL" side="acceptor" />
      </div>

      {/* Witness Tray */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-foreground" style={{ fontSize: "13px", fontWeight: 600 }}>Witness Panel</p>
            <p className="text-muted-foreground" style={{ fontSize: "11px" }}>
              {witnesses.filter(w => w.hasVoted).length} of {witnesses.length} votes cast
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-muted border border-border text-muted-foreground"
            style={{ fontSize: "10px", fontFamily: "'JetBrains Mono', monospace" }}>
            QUORUM: 2/3 NEEDED
          </span>
        </div>

        <div className="flex items-center justify-center gap-8">
          {witnesses.map((w) => (
            <WitnessAvatar key={w.id} witness={w} challengerInitials="Alice" acceptorInitials="Bob" />
          ))}
        </div>

        <div className="mt-4 pt-3 border-t border-border">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-[#9945FF] transition-all duration-500"
                style={{ width: `${(witnesses.filter(w => w.hasVoted).length / witnesses.length) * 100}%` }} />
            </div>
            <span className="text-muted-foreground shrink-0" style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" }}>
              {Math.round((witnesses.filter(w => w.hasVoted).length / witnesses.length) * 100)}% voted
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
