import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Send, Paperclip, Hash, Zap, Shield, Clock,
  CheckCircle2, Users, AlertTriangle, ChevronRight, Smile
} from "lucide-react";
import { Avatar, Pill, Card, Mono, Divider } from "./ui";
import {
  getGroups, getBets, getMessages, postMessage,
  type Group as ApiGroup, type Bet as ApiBet, type ChatMessage,
} from "../../lib/relayer";

/* ── Data ──────────────────────────────────────────────── */
const GROUPS = [
  { id: "1", name: "The Dev Pack",   initials: "DP", members: 8,  pendingBet: true,  lastMsg: "Kevin just dropped a bet 🔥",     time: "2:18 PM"  },
  { id: "2", name: "Grind Season",   initials: "GS", members: 5,  pendingBet: false, lastMsg: "Who's running tomorrow AM?",        time: "1:04 PM"  },
  { id: "3", name: "Ship It Gang",   initials: "SI", members: 12, pendingBet: true,  lastMsg: "New DevBet awaiting votes",          time: "11:42 AM" },
  { id: "4", name: "Alpha Cadre",    initials: "AC", members: 3,  pendingBet: false, lastMsg: "Nice streak, Matt! 🏆",              time: "Yesterday"},
];

type BetStatus = "PENDING" | "ACTIVE" | "RESOLVED";
type BetType   = "PERSONAL" | "DEV";

interface Bet {
  id:        string;
  type:      BetType;
  challenger:string;
  acceptor:  string;
  terms:     string;
  stake:     string;
  currency:  string;
  status:    BetStatus;
  witnesses: number;
  minBettors:number;
  groupSize: number;
}

const BETS: Bet[] = [
  {
    id: "bet-001", type: "PERSONAL",
    challenger: "Kevin", acceptor: "Matt",
    terms: "Kevin wagers Matt that Matt cannot run a 5k tomorrow morning",
    stake: "500", currency: "POINTS",
    status: "PENDING", witnesses: 1, minBettors: 2, groupSize: 8,
  },
  {
    id: "bet-002", type: "DEV",
    challenger: "Sarah", acceptor: "Jordan",
    terms: "Sarah bets Jordan cannot ship a full-stack feature before midnight",
    stake: "0.25", currency: "SOL",
    status: "ACTIVE", witnesses: 2, minBettors: 2, groupSize: 8,
  },
];

interface Msg {
  id: string;
  sender: string;
  initials: string;
  text?: string;
  bet?: Bet;
  system: boolean;
  ts: string;
}

const MESSAGES: Msg[] = [
  { id:"m1", sender:"Kevin",  initials:"KV", text:"Alright, I'm feeling extremely bold today. Someone get in the ring with me.", system:false, ts:"2:10 PM" },
  { id:"m2", sender:"Matt",   initials:"MT", text:"Oh yeah? What's the move 👀",                                                  system:false, ts:"2:11 PM" },
  { id:"m3", sender:"System", initials:"SY", bet:BETS[0],                                                                        system:true,  ts:"2:14 PM" },
  { id:"m4", sender:"Jordan", initials:"JD", text:"LMAOOO Kevin is not playing around 💀",                                       system:false, ts:"2:15 PM" },
  { id:"m5", sender:"Sarah",  initials:"SR", text:"Matt you better have your running shoes ready 👟",                            system:false, ts:"2:16 PM" },
  { id:"m6", sender:"System", initials:"SY", bet:BETS[1],                                                                        system:true,  ts:"11:02 AM"},
  { id:"m7", sender:"Kevin",  initials:"KV", text:"Dev bets hit different fr. AI doesn't lie 🤖",                                system:false, ts:"2:18 PM" },
  { id:"m8", sender:"Matt",   initials:"MT", text:"Fine. Fine. I accept. But if I lose I'm deleting the app 😤",                 system:false, ts:"2:19 PM" },
];

/* ── Embedded Bet Card ─────────────────────────────────── */
function BetTypeTag({ type }: { type: BetType }) {
  return (
    <Pill color={type === "DEV" ? "teal" : "purple"}>
      {type === "DEV" ? <Zap size={8} /> : <Shield size={8} />}
      BET TYPE: {type}
    </Pill>
  );
}

function StatusTag({ status }: { status: BetStatus }) {
  const map: Record<BetStatus, { color: "amber" | "teal" | "muted"; icon: typeof Clock }> = {
    PENDING:  { color: "amber",  icon: Clock         },
    ACTIVE:   { color: "teal",   icon: CheckCircle2  },
    RESOLVED: { color: "muted",  icon: AlertTriangle },
  };
  const { color, icon: Icon } = map[status];
  return (
    <Pill color={color}>
      <Icon size={8} />
      {status}
    </Pill>
  );
}

function EmbeddedBetCard({ bet }: { bet: Bet }) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className="w-full max-w-[420px] rounded-2xl border overflow-hidden transition-all duration-200"
      style={{
        background: "var(--card)",
        borderColor: hovered
          ? bet.type === "DEV" ? "rgba(20,241,149,0.35)" : "rgba(153,69,255,0.35)"
          : "var(--border)",
        boxShadow: hovered
          ? bet.type === "DEV"
            ? "0 0 0 1px rgba(20,241,149,0.15), 0 8px 24px rgba(0,0,0,0.15)"
            : "0 0 0 1px rgba(153,69,255,0.15), 0 8px 24px rgba(0,0,0,0.15)"
          : "0 2px 8px rgba(0,0,0,0.08)",
      }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <BetTypeTag type={bet.type} />
        <div className="flex items-center gap-2">
          <StatusTag status={bet.status} />
          <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
            #{bet.id.toUpperCase()}
          </Mono>
        </div>
      </div>

      {/* Terms */}
      <div className="px-4 pt-4 pb-3">
        <p className="text-foreground leading-snug"
          style={{ fontSize: "16px", fontWeight: 700, letterSpacing: "-0.01em" }}>
          "{bet.terms}"
        </p>

        <div className="mt-3 flex items-center gap-2.5">
          <span
            className="px-2.5 py-1 rounded-lg"
            style={{
              background: bet.currency === "SOL"
                ? "rgba(153,69,255,0.12)" : "rgba(255,184,0,0.12)",
              color: bet.currency === "SOL" ? "#9945FF" : "#FFB800",
              fontSize: "15px",
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {bet.stake} {bet.currency}
          </span>
          <span className="text-muted-foreground" style={{ fontSize: "12px" }}>
            locked in escrow on accept
          </span>
        </div>
      </div>

      {/* Footer rules */}
      <div className="px-4 pb-3 flex items-center justify-between">
        <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
          Min {bet.minBettors} Bettors · {bet.witnesses} Witness Required · Group ≥ 3{" "}
          <span style={{ color: "#14F195" }}>✓ valid ({bet.groupSize} members)</span>
        </Mono>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border font-semibold transition-colors"
          style={{
            fontSize: "11px",
            color: bet.type === "DEV" ? "#14F195" : "#9945FF",
            borderColor: bet.type === "DEV" ? "rgba(20,241,149,0.3)" : "rgba(153,69,255,0.3)",
            background: bet.type === "DEV" ? "rgba(20,241,149,0.08)" : "rgba(153,69,255,0.08)",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          Accept <ChevronRight size={10} />
        </motion.button>
      </div>
    </motion.div>
  );
}

/* ── Chat message ──────────────────────────────────────── */
function Message({ msg }: { msg: Msg }) {
  if (msg.system && msg.bet) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-muted-foreground" style={{ fontSize: "11px" }}>
          <Zap size={10} className="text-primary" />
          <Mono style={{ fontSize: "10px" } as React.CSSProperties}>
            AccountabiliBuddy · system card · {msg.ts}
          </Mono>
        </div>
        <EmbeddedBetCard bet={msg.bet} />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5">
      <Avatar initials={msg.initials} size={32} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-foreground" style={{ fontSize: "13px", fontWeight: 600 }}>{msg.sender}</span>
          <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>{msg.ts}</Mono>
        </div>
        <p className="text-foreground/85 leading-relaxed" style={{ fontSize: "14px" }}>{msg.text}</p>
      </div>
    </div>
  );
}

/* ── Main view ─────────────────────────────────────────── */
export function ChatView() {
  const [activeGroup, setActiveGroup] = useState("1");
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Live from the relayer (Mongo-backed) when available; design fixtures otherwise.
  const [groups, setGroups] = useState<(typeof GROUPS[number] | ApiGroup)[]>(GROUPS);
  const [bets, setBets] = useState<Bet[]>(BETS);
  const [messages, setMessages] = useState<Msg[]>(MESSAGES);
  const [live, setLive] = useState(false);

  /* Build the embedded-bet lookup so system messages can resolve their bet. */
  const betsById = Object.fromEntries(bets.map(b => [b.id, b])) as Record<string, Bet>;

  /* Map a relayer message doc into the local Msg shape (resolving betId → bet). */
  function toMsg(m: ChatMessage): Msg {
    return {
      id: m.id, sender: m.sender, initials: m.initials,
      text: m.text, bet: m.betId ? betsById[m.betId] : undefined,
      system: m.system, ts: m.ts,
    };
  }

  /* Load groups + bets once; fall back to fixtures on any failure. */
  useEffect(() => {
    let alive = true;
    Promise.all([getGroups(), getBets()])
      .then(([g, b]) => {
        if (!alive) return;
        if (b.bets.length) setBets(b.bets as Bet[]);
        if (g.groups.length) { setGroups(g.groups); setLive(true); }
      })
      .catch(() => { /* relayer offline or DB unconfigured — keep fixtures */ });
    return () => { alive = false; };
  }, []);

  /* Load messages for the active group (only when running live). */
  useEffect(() => {
    if (!live) return;
    let alive = true;
    getMessages(activeGroup)
      .then(({ messages }) => { if (alive) setMessages(messages.map(toMsg)); })
      .catch(() => { /* keep whatever is shown */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup, live]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const optimistic: Msg = {
      id: `local-${Date.now()}`, sender: "Me", initials: "ME",
      text, system: false,
      ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages(prev => [...prev, optimistic]);
    if (!live) return; // demo mode — keep it local only
    try {
      const { message } = await postMessage({ groupId: activeGroup, sender: "Me", initials: "ME", text });
      setMessages(prev => prev.map(m => (m.id === optimistic.id ? toMsg(message) : m)));
    } catch {
      /* leave the optimistic message in place */
    }
  }

  return (
    <div className="flex h-full rounded-2xl border border-border overflow-hidden" style={{ background: "var(--card)" }}>

      {/* ── Left sidebar ─────────────────────────────── */}
      <div className="w-60 flex flex-col shrink-0 border-r border-border" style={{ background: "var(--muted)" }}>

        <div className="px-4 py-3 border-b border-border">
          <Mono className="text-muted-foreground uppercase" style={{ fontSize: "9px", letterSpacing: "0.1em" } as React.CSSProperties}>
            Group Chats
          </Mono>
        </div>

        <div className="flex-1 overflow-y-auto py-1.5 space-y-0.5 px-1.5">
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => setActiveGroup(g.id)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-left transition-all duration-150 ${
                activeGroup === g.id
                  ? "bg-primary/10"
                  : "hover:bg-card"
              }`}
            >
              <div className="relative shrink-0">
                <Avatar initials={g.initials} size={34} />
                {g.pendingBet && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card"
                    style={{ background: "#FFB800" }} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`truncate ${activeGroup === g.id ? "text-primary" : "text-foreground"}`}
                    style={{ fontSize: "12px", fontWeight: 600 }}
                  >
                    {g.name}
                  </span>
                  <Mono className="text-muted-foreground shrink-0" style={{ fontSize: "9px" } as React.CSSProperties}>
                    {g.time}
                  </Mono>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <Users size={9} className="text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground truncate" style={{ fontSize: "11px" }}>
                    {g.members} · {g.lastMsg}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="p-2 border-t border-border">
          <button
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-border
              text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors"
            style={{ fontSize: "11px" }}
          >
            <Hash size={11} /> New Group
          </button>
        </div>
      </div>

      {/* ── Main chat panel ──────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <Avatar initials={groups.find(g => g.id === activeGroup)?.initials ?? "DP"} size={36} />
            <div>
              <p className="text-foreground" style={{ fontSize: "14px", fontWeight: 700 }}>
                {groups.find(g => g.id === activeGroup)?.name}
              </p>
              <p className="flex items-center gap-1.5 text-muted-foreground" style={{ fontSize: "11px" }}>
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "#14F195" }} />
                {groups.find(g => g.id === activeGroup)?.members} members · {live ? "live" : "demo"}
              </p>
            </div>
          </div>
          <Pill color="amber">
            <AlertTriangle size={8} />
            1 BET PENDING RESOLUTION
          </Pill>
        </div>

        {/* Feed */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          <AnimatePresence>
            {messages.map((msg, i) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: i * 0.04 }}
              >
                <Message msg={msg} />
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-5 py-3.5 border-t border-border shrink-0">
          <div
            className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border transition-all duration-150"
            style={{ background: "var(--muted)" }}
          >
            <Paperclip size={14} className="text-muted-foreground shrink-0" />
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void send(); } }}
              placeholder={`Message ${groups.find(g => g.id === activeGroup)?.name ?? ""}…`}
              className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none min-w-0"
              style={{ fontSize: "13px" }}
            />
            <Smile size={14} className="text-muted-foreground shrink-0 cursor-pointer hover:text-foreground transition-colors" />
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.94 }}
              onClick={() => void send()}
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors"
              style={{ background: input.trim() ? "var(--primary)" : "var(--border)" }}
            >
              <Send size={12} className={input.trim() ? "text-white" : "text-muted-foreground"} />
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}
