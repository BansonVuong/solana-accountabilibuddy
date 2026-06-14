import { useState } from "react";
import {
  Users, CheckCircle2, Clock, AlertCircle, Send, Paperclip,
  Hash, ChevronRight, Zap, Shield
} from "lucide-react";

interface BetCard {
  id: string;
  type: "PERSONAL" | "DEV";
  challenger: string;
  acceptor: string;
  terms: string;
  stake: string;
  status: "PENDING" | "ACTIVE" | "RESOLVED";
  witnesses: number;
  minBettors: number;
  groupSize: number;
  timestamp: string;
}

interface ChatGroup {
  id: string;
  name: string;
  avatar: string;
  members: number;
  activeBet: boolean;
  lastMessage: string;
}

const groups: ChatGroup[] = [
  { id: "1", name: "The Dev Pack", avatar: "DP", members: 8, activeBet: true, lastMessage: "Kevin just dropped a bet 🔥" },
  { id: "2", name: "Grind Season", avatar: "GS", members: 5, activeBet: false, lastMessage: "Who's up for tomorrow?" },
  { id: "3", name: "Ship It Gang", avatar: "SI", members: 12, activeBet: true, lastMessage: "New DevBet awaiting votes" },
  { id: "4", name: "Alpha Cadre", avatar: "AC", members: 3, activeBet: false, lastMessage: "Nice streak Matt!" },
];

const betCards: BetCard[] = [
  {
    id: "bet-001",
    type: "PERSONAL",
    challenger: "Kevin",
    acceptor: "Matt",
    terms: "Kevin wagers Matt that Matt cannot run a 5k tomorrow morning",
    stake: "0.05 SOL",
    status: "PENDING",
    witnesses: 2,
    minBettors: 2,
    groupSize: 8,
    timestamp: "2:14 PM",
  },
  {
    id: "bet-002",
    type: "DEV",
    challenger: "Sarah",
    acceptor: "Jordan",
    terms: "Sarah bets Jordan cannot merge a meaningful PR before midnight",
    stake: "0.25 SOL",
    status: "ACTIVE",
    witnesses: 1,
    minBettors: 2,
    groupSize: 8,
    timestamp: "11:02 AM",
  },
];

interface Message {
  id: string;
  sender: string;
  avatar: string;
  content?: string;
  betCard?: BetCard;
  timestamp: string;
  isSystem?: boolean;
}

const messages: Message[] = [
  { id: "m1", sender: "Kevin", avatar: "KV", content: "Alright fellas, I'm feeling bold today 😤", timestamp: "2:10 PM" },
  { id: "m2", sender: "Matt", avatar: "MT", content: "Oh yeah? What's the move", timestamp: "2:11 PM" },
  { id: "m3", sender: "System", avatar: "SY", betCard: betCards[0], timestamp: "2:14 PM", isSystem: true },
  { id: "m4", sender: "Jordan", avatar: "JD", content: "LMAOOO Kevin does not miss 💀", timestamp: "2:15 PM" },
  { id: "m5", sender: "Sarah", avatar: "SR", content: "Matt you better lace up rn 👟", timestamp: "2:16 PM" },
  { id: "m6", sender: "System", avatar: "SY", betCard: betCards[1], timestamp: "11:02 AM", isSystem: true },
  { id: "m7", sender: "Kevin", avatar: "KV", content: "Dev bets are a different breed fr", timestamp: "2:18 PM" },
];

function AvatarBubble({ initials, size = "md", color = "purple" }: { initials: string; size?: "sm" | "md" | "lg"; color?: string }) {
  const sizes = { sm: "w-7 h-7 text-xs", md: "w-9 h-9 text-sm", lg: "w-11 h-11 text-base" };
  const colors: Record<string, string> = {
    purple: "bg-[#9945FF]/20 text-[#9945FF]",
    teal: "bg-[#14F195]/20 text-[#14F195]",
    amber: "bg-[#FFB800]/20 text-[#FFB800]",
    crimson: "bg-[#FF4A4A]/20 text-[#FF4A4A]",
    blue: "bg-blue-500/20 text-blue-400",
  };
  const colorMap: Record<string, string> = {
    KV: "purple", MT: "teal", JD: "amber", SR: "crimson", DP: "purple",
    GS: "teal", SI: "blue", AC: "amber",
  };
  const c = colors[colorMap[initials] || color] || colors.purple;
  return (
    <div className={`${sizes[size]} ${c} rounded-full flex items-center justify-center font-semibold shrink-0`}
      style={{ fontFamily: "'Inter', sans-serif" }}>
      {initials}
    </div>
  );
}

function BetTypeTag({ type }: { type: "PERSONAL" | "DEV" }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold tracking-widest uppercase ${
      type === "DEV"
        ? "bg-[#14F195]/10 text-[#14F195] border border-[#14F195]/20"
        : "bg-[#9945FF]/10 text-[#9945FF] border border-[#9945FF]/20"
    }`} style={{ fontFamily: "'JetBrains Mono', monospace" }}>
      {type === "DEV" ? <Zap size={9} /> : <Shield size={9} />}
      BET TYPE: {type}
    </span>
  );
}

function EmbeddedBetCard({ bet }: { bet: BetCard }) {
  const statusColors = {
    PENDING: "text-[#FFB800] bg-[#FFB800]/10 border-[#FFB800]/20",
    ACTIVE: "text-[#14F195] bg-[#14F195]/10 border-[#14F195]/20",
    RESOLVED: "text-[#8A99AD] bg-[#8A99AD]/10 border-[#8A99AD]/20",
  };
  const StatusIcon = { PENDING: Clock, ACTIVE: CheckCircle2, RESOLVED: AlertCircle }[bet.status];

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden w-full max-w-md
      hover:border-primary/30 transition-all duration-200 group">
      <div className="px-4 pt-3 pb-2 border-b border-border flex items-center justify-between">
        <BetTypeTag type={bet.type} />
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${statusColors[bet.status]}`}
          style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          <StatusIcon size={9} />
          {bet.status}
        </span>
      </div>

      <div className="px-4 py-4">
        <p className="text-foreground leading-snug" style={{ fontSize: "17px", fontWeight: 600 }}>
          "{bet.terms}"
        </p>
        <div className="mt-3 flex items-center gap-3">
          <span className="text-[#9945FF]" style={{ fontSize: "13px", fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}>
            STAKE: {bet.stake}
          </span>
          <span className="text-muted-foreground" style={{ fontSize: "12px" }}>·</span>
          <span className="text-muted-foreground" style={{ fontSize: "12px" }}>{bet.timestamp}</span>
        </div>
      </div>

      <div className="px-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground" style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" }}>
            Min {bet.minBettors} Bettors · {bet.witnesses} Witness req · Group {bet.groupSize}+ ✓
          </span>
        </div>
        <button className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20
          transition-colors text-[12px] font-semibold border border-primary/20">
          Accept
        </button>
      </div>
    </div>
  );
}

export function GroupChatLobby() {
  const [selectedGroup, setSelectedGroup] = useState("1");
  const [input, setInput] = useState("");

  return (
    <div className="flex h-full overflow-hidden rounded-2xl border border-border bg-card">
      {/* Left Sidebar */}
      <div className="w-64 border-r border-border flex flex-col shrink-0 bg-muted/30">
        <div className="px-4 py-4 border-b border-border">
          <p className="text-muted-foreground uppercase tracking-widest"
            style={{ fontSize: "10px", fontFamily: "'JetBrains Mono', monospace" }}>
            Group Chats
          </p>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => setSelectedGroup(g.id)}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg mx-1 transition-all duration-150 text-left
                ${selectedGroup === g.id ? "bg-primary/10" : "hover:bg-muted/50"}`}
            >
              <div className="relative shrink-0">
                <AvatarBubble initials={g.avatar} size="md" />
                {g.activeBet && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#FFB800] border-2 border-card" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className={`truncate ${selectedGroup === g.id ? "text-primary" : "text-foreground"}`}
                    style={{ fontSize: "13px", fontWeight: 600 }}>
                    {g.name}
                  </span>
                  <span className="flex items-center gap-0.5 text-muted-foreground shrink-0 ml-2"
                    style={{ fontSize: "10px" }}>
                    <Users size={9} />
                    {g.members}
                  </span>
                </div>
                <p className="truncate text-muted-foreground" style={{ fontSize: "11px" }}>
                  {g.lastMessage}
                </p>
              </div>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-border">
          <button className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-border
            text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
            style={{ fontSize: "12px" }}>
            <Hash size={12} />
            New Group
          </button>
        </div>
      </div>

      {/* Main Chat Panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <AvatarBubble initials="DP" size="md" />
            <div>
              <p className="text-foreground" style={{ fontSize: "15px", fontWeight: 600 }}>The Dev Pack</p>
              <p className="text-muted-foreground flex items-center gap-1" style={{ fontSize: "11px" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#14F195] inline-block" />
                8 members · 3 online
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="px-2.5 py-1 rounded-full bg-[#FFB800]/10 text-[#FFB800] border border-[#FFB800]/20 flex items-center gap-1"
              style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" }}>
              <AlertCircle size={10} />
              1 BET PENDING
            </span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.map((msg) => (
            <div key={msg.id}>
              {msg.isSystem && msg.betCard ? (
                <div className="flex flex-col items-start gap-1">
                  <span className="text-muted-foreground flex items-center gap-1" style={{ fontSize: "11px" }}>
                    <Zap size={10} className="text-[#9945FF]" />
                    BAAM dropped a bet card
                  </span>
                  <EmbeddedBetCard bet={msg.betCard} />
                </div>
              ) : (
                <div className="flex items-start gap-2.5">
                  <AvatarBubble initials={msg.avatar} size="sm" />
                  <div>
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-foreground" style={{ fontSize: "13px", fontWeight: 600 }}>{msg.sender}</span>
                      <span className="text-muted-foreground" style={{ fontSize: "11px" }}>{msg.timestamp}</span>
                    </div>
                    <p className="text-foreground/90" style={{ fontSize: "14px" }}>{msg.content}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Input */}
        <div className="px-5 py-3.5 border-t border-border shrink-0">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-muted/50 border border-border">
            <Paperclip size={15} className="text-muted-foreground shrink-0" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message The Dev Pack…"
              className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
              style={{ fontSize: "14px" }}
            />
            <button className="p-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
              <Send size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
