import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Send, Paperclip, Hash, Users, AlertTriangle, Smile, Plus,
  CheckCircle2, Clock, UserPlus, ChevronRight, Zap, Shield, AlertCircle,
  Lock, ExternalLink,
} from "lucide-react";
import { Avatar, Pill, Mono } from "./ui";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { SendBetModal, type NewBet } from "./SendBetModal";
import {
  acceptBet,
  addGroupMemberByUsername,
  createGroup,
  createBet,
  explorerTxUrl,
  getBets,
  getGroups,
  getMessages,
  postMessage,
  voteBet,
  type AuthUser,
  type Bet,
  type BetVoteChoice,
  type ChatMessage,
  type Group,
} from "../../lib/relayer";

type Msg = ChatMessage;
type ChatDialog =
  | { type: "create-group" }
  | { type: "add-member"; groupName: string }
  | { type: "confirm-accept"; betId: string; challenger: string; stake: string; currency: string }
  | { type: "confirm-vote"; betId: string; votedFor: BetVoteChoice; candidateName: string; isChange: boolean }
  | { type: "result"; title: string; description: string; tone: "success" | "error" };

function toInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "NA";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
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

function isBetParticipant(bet: Bet, username: string): boolean {
  const normalizedUsername = username.trim().toLowerCase();
  if (!normalizedUsername) return false;
  return [
    bet.challenger,
    bet.acceptor,
    bet.acceptedBy,
    bet.opponentUsername,
  ].some(
    (name) => typeof name === "string" && name.trim().toLowerCase() === normalizedUsername,
  );
}
const MIN_REAL_TIMESTAMP_MS = Date.UTC(2000, 0, 1);

function formatChatTime(timestampMs: number | undefined, fallback: string): string {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs) || timestampMs < MIN_REAL_TIMESTAMP_MS) {
    return fallback;
  }
  return new Date(timestampMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function applyVoteToBet(bet: Bet, voter: string, votedFor: BetVoteChoice): Bet {
  if (isBetCompleted(bet) || bet.status !== "ACTIVE") return bet;
  const nextVotesByVoter: Record<string, BetVoteChoice> = {
    ...getVotesByVoter(bet),
    [voter]: votedFor,
  };
  const nextBet: Bet = {
    ...bet,
    votesByVoter: nextVotesByVoter,
  };
  const winner = getResolvedWinner(nextBet);
  return {
    ...nextBet,
    status: winner ? "COMPLETED" : bet.status,
    resolvedWinner: winner,
  };
}

function StatusTag({ status }: { status: Bet["status"] }) {
  const normalizedStatus: "PENDING" | "ACTIVE" | "COMPLETED" =
    status === "RESOLVED" ? "COMPLETED" : status;
  const map = {
    PENDING: { color: "amber" as const, icon: Clock },
    ACTIVE: { color: "teal" as const, icon: CheckCircle2 },
    COMPLETED: { color: "muted" as const, icon: CheckCircle2 },
  };
  const meta = map[normalizedStatus] ?? map.PENDING;
  const Icon = meta.icon;
  return (
    <Pill color={meta.color}>
      <Icon size={8} />
      {normalizedStatus}
    </Pill>
  );
}

function BetTypeTag({ bet }: { bet: Bet }) {
  const isSports = bet.validation === "sports";
  const showDevPalette = isSports || bet.type === "DEV";
  const label = isSports ? "SPORTS" : bet.type;
  return (
    <Pill color={showDevPalette ? "teal" : "purple"}>
      {showDevPalette ? <Zap size={8} /> : <Shield size={8} />}
      BET TYPE: {label}
    </Pill>
  );
}

function onChainLabel(state?: Bet["onChainState"]): string {
  switch (state) {
    case "open": return "ESCROW OPEN · awaiting match";
    case "locked": return "LOCKED IN ESCROW · on-chain";
    case "settled": return "PAID OUT ON-CHAIN";
    case "cancelled": return "REFUNDED · window expired";
    default: return "ON-CHAIN ESCROW";
  }
}

function ExplorerLink({ sig, label }: { sig: string; label: string }) {
  return (
    <a
      href={explorerTxUrl(sig)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-[#14F195] hover:underline"
      style={{ fontSize: "10px", fontFamily: "'JetBrains Mono', monospace" }}
    >
      {label}
      <ExternalLink size={9} />
    </a>
  );
}

function EmbeddedBetCard({
  bet,
  voterName,
  isVoting,
  isAccepting,
  onAccept,
  onVote,
}: {
  bet: Bet;
  voterName: string;
  isVoting: boolean;
  isAccepting: boolean;
  onAccept: (bet: Bet) => void;
  onVote: (betId: string, votedFor: BetVoteChoice) => void;
}) {
  const votes = countVotes(bet);
  const witnessThreshold = Math.max(1, Number(bet.witnesses) || 1);
  const winner = getResolvedWinner(bet);
  const isResolved = isBetCompleted(bet);
  const winnerName = winner === "challenger" ? bet.challenger : bet.acceptor;
  const myVote = getVotesByVoter(bet)[voterName];
  const quorumPct = Math.min(100, (votes.total / witnessThreshold) * 100);
  const isPending = bet.status === "PENDING";
  const isAddressedToViewer = bet.acceptor.toLowerCase() === voterName.toLowerCase()
    || bet.acceptor.toLowerCase() === "anyone";
  const canAccept = isPending
    && bet.challenger.toLowerCase() !== voterName.toLowerCase()
    && isAddressedToViewer
    && !isAccepting;
  const pendingAcceptorLabel = bet.acceptor.toLowerCase() === "anyone"
    ? "any eligible member"
    : bet.acceptor;
  // Sports bets are settled by the sports feed, not witness votes.
  const isSports = bet.validation === "sports";
  const isParticipant = isBetParticipant(bet, voterName);
  const canVote = !isSports && !isParticipant && bet.status === "ACTIVE" && !isResolved && !winner && !isVoting;

  return (
    <div className="w-full max-w-[420px] rounded-2xl border border-border overflow-hidden bg-card">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <BetTypeTag bet={bet} />
        <StatusTag status={bet.status} />
      </div>

      <div className="px-4 pt-4 pb-3">
        <p className="text-foreground leading-snug" style={{ fontSize: "15px", fontWeight: 600 }}>
          "{bet.terms}"
        </p>
        {!isSports && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-[#9945FF]/20 bg-[#9945FF]/8 px-2.5 py-2">
              <Mono className="block text-[#9945FF]" style={{ fontSize: "9px" } as React.CSSProperties}>
                CHALLENGER
              </Mono>
              <span className="text-foreground" style={{ fontSize: "12px", fontWeight: 600 }}>
                {bet.challenger}
              </span>
            </div>
            <div className="rounded-lg border border-[#14F195]/20 bg-[#14F195]/8 px-2.5 py-2">
              <Mono className="block text-[#14F195]" style={{ fontSize: "9px" } as React.CSSProperties}>
                RECIPIENT
              </Mono>
              <span className="text-foreground" style={{ fontSize: "12px", fontWeight: 600 }}>
                {pendingAcceptorLabel}
              </span>
            </div>
          </div>
        )}
        <div className="mt-3 flex items-center gap-2.5">
          <span
            className="px-2.5 py-1 rounded-lg"
            style={{
              background: bet.currency === "SOL" ? "rgba(153,69,255,0.12)" : "rgba(255,184,0,0.12)",
              color: bet.currency === "SOL" ? "#9945FF" : "#FFB800",
              fontSize: "14px",
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {bet.stake} {bet.currency}
          </span>
          <span className="text-muted-foreground" style={{ fontSize: "11px" }}>
            {isSports ? "official final result decides outcome" : "witnesses decide outcome"}
          </span>
        </div>
      </div>

      <div className="px-4 pb-3 flex items-center justify-between">
        <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
          {isSports
            ? `${(bet.sport ?? "").toUpperCase()} · auto-settled`
            : `quorum ${witnessThreshold} · votes ${votes.challenger}-${votes.acceptor}`}
        </Mono>
        <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
          #{bet.id.toUpperCase()}
        </Mono>
      </div>

      <div className="px-4 pb-4 space-y-2.5">
        {!isSports && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${quorumPct}%`,
                background: winner ? "linear-gradient(90deg, #14F195, #9945FF)" : "linear-gradient(90deg, #9945FF, #9945FFcc)",
              }}
            />
          </div>
          <Mono className="text-muted-foreground shrink-0" style={{ fontSize: "10px" } as React.CSSProperties}>
            {votes.total}/{witnessThreshold}
          </Mono>
        </div>
        )}

        {winner || isResolved ? (
          <div className="rounded-lg px-3 py-2 border border-[#14F195]/25 bg-[#14F195]/8">
            <span className="text-[#14F195]" style={{ fontSize: "11px", fontWeight: 700 }}>
              {winner ? `Completed — winner: ${winnerName}` : "Completed"}
            </span>
          </div>
        ) : isPending ? (
          canAccept ? (
            <Button className="w-full" onClick={() => onAccept(bet)} disabled={isAccepting}>
              {isAccepting ? "Accepting..." : `Accept ${bet.stake} ${bet.currency} challenge`}
            </Button>
          ) : (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2">
              <span className="text-amber-500" style={{ fontSize: "11px", fontWeight: 700 }}>
                Waiting for {pendingAcceptorLabel} to accept
              </span>
            </div>
          )
        ) : isSports ? (
          <div className="rounded-lg border border-[#9945FF]/25 bg-[#9945FF]/8 px-3 py-2">
            <span className="text-[#9945FF]" style={{ fontSize: "11px", fontWeight: 700 }}>
              Locked — awaiting final {(bet.sport ?? "game").toUpperCase()} result
            </span>
          </div>
        ) : isParticipant ? (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2">
            <span className="text-amber-500" style={{ fontSize: "11px", fontWeight: 700 }}>
              Bet participants cannot vote as witnesses
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <motion.button
              whileHover={canVote ? { scale: 1.01 } : undefined}
              whileTap={canVote ? { scale: 0.97 } : undefined}
              disabled={!canVote}
              onClick={() => onVote(bet.id, "challenger")}
              className="rounded-lg px-2.5 py-2 border font-semibold transition-colors disabled:cursor-not-allowed"
              style={{
                fontSize: "11px",
                color: "#9945FF",
                borderColor: myVote === "challenger" ? "rgba(153,69,255,0.5)" : "rgba(153,69,255,0.25)",
                background: myVote === "challenger" ? "rgba(153,69,255,0.16)" : "rgba(153,69,255,0.08)",
                opacity: canVote || myVote === "challenger" ? 1 : 0.65,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              Vote {bet.challenger}
            </motion.button>
            <motion.button
              whileHover={canVote ? { scale: 1.01 } : undefined}
              whileTap={canVote ? { scale: 0.97 } : undefined}
              disabled={!canVote}
              onClick={() => onVote(bet.id, "acceptor")}
              className="rounded-lg px-2.5 py-2 border font-semibold transition-colors disabled:cursor-not-allowed"
              style={{
                fontSize: "11px",
                color: "#14F195",
                borderColor: myVote === "acceptor" ? "rgba(20,241,149,0.5)" : "rgba(20,241,149,0.25)",
                background: myVote === "acceptor" ? "rgba(20,241,149,0.16)" : "rgba(20,241,149,0.08)",
                opacity: canVote || myVote === "acceptor" ? 1 : 0.65,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              Vote {bet.acceptor}
            </motion.button>
          </div>
        )}

        {isVoting && (
          <Mono className="text-muted-foreground block" style={{ fontSize: "10px" } as React.CSSProperties}>
            submitting vote…
          </Mono>
        )}
      </div>

      {bet.onChain && (
        <div className="px-4 py-2.5 border-t border-border flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Lock size={10} style={{ color: "#9945FF" }} />
            <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
              {onChainLabel(bet.onChainState)}
            </Mono>
          </div>
          <div className="flex items-center gap-2.5">
            {bet.createSig === bet.acceptSig ? (
              bet.createSig && <ExplorerLink sig={bet.createSig} label="escrow" />
            ) : (
              <>
                {bet.createSig && <ExplorerLink sig={bet.createSig} label="stake" />}
                {bet.acceptSig && <ExplorerLink sig={bet.acceptSig} label="match" />}
              </>
            )}
            {bet.settleSig && <ExplorerLink sig={bet.settleSig} label="payout" />}
          </div>
        </div>
      )}
    </div>
  );
}

function Message({
  msg,
  bet,
  voterName,
  onVote,
  onAccept,
  isVoting,
  isAccepting,
}: {
  msg: Msg;
  bet?: Bet;
  voterName: string;
  onVote: (betId: string, votedFor: BetVoteChoice) => void;
  onAccept: (bet: Bet) => void;
  isVoting: (betId: string) => boolean;
  isAccepting: (betId: string) => boolean;
}) {
  const timeLabel = formatChatTime(msg.createdAt, msg.ts);
  if (msg.system && bet) {
    return (
      <div className="flex flex-col gap-1.5">
        <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
          system card · {timeLabel}
        </Mono>
        <EmbeddedBetCard
          bet={bet}
          voterName={voterName}
          onVote={onVote}
          onAccept={onAccept}
          isVoting={isVoting(bet.id)}
          isAccepting={isAccepting(bet.id)}
        />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5">
      <Avatar initials={msg.initials} size={32} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-foreground" style={{ fontSize: "13px", fontWeight: 600 }}>{msg.sender}</span>
          <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>{timeLabel}</Mono>
        </div>
        <p className="text-foreground/85 leading-relaxed" style={{ fontSize: "14px" }}>{msg.text}</p>
      </div>
    </div>
  );
}

export function ChatView({
  currentUser,
  onUnreadCountChange,
  requestedGroupId,
  requestedBetId,
  requestedGroupToken,
}: {
  currentUser: AuthUser;
  onUnreadCountChange?: (count: number) => void;
  requestedGroupId?: string;
  requestedBetId?: string;
  requestedGroupToken?: number;
}) {
  const [activeGroup, setActiveGroup] = useState<string>("");
  const [input, setInput] = useState("");
  const [betModalOpen, setBetModalOpen] = useState(false);
  const [showCompletedBets, setShowCompletedBets] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [bets, setBets] = useState<Bet[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [votingByBetId, setVotingByBetId] = useState<Record<string, boolean>>({});
  const [acceptingByBetId, setAcceptingByBetId] = useState<Record<string, boolean>>({});
  const [chatDialog, setChatDialog] = useState<ChatDialog | null>(null);
  const [dialogInput, setDialogInput] = useState("");
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [unreadByGroup, setUnreadByGroup] = useState<Record<string, number>>({});
  const [lastReadByGroup, setLastReadByGroup] = useState<Record<string, number>>({});
  const [highlightedBetId, setHighlightedBetId] = useState<string | null>(null);
  const activeGroupRef = useRef<string>("");
  const lastReadByGroupRef = useRef<Record<string, number>>({});
  const lastHandledGroupRequestTokenRef = useRef<number | undefined>(undefined);
  const pendingRequestedBetIdRef = useRef<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const unreadStorageKey = `accountabilibuddy_last_read_by_group_${currentUser.username.toLowerCase()}`;

  const betsById = useMemo(
    () => Object.fromEntries(bets.map((bet) => [bet.id, bet])) as Record<string, Bet>,
    [bets],
  );
  const activeGroupData = groups.find((group) => group.id === activeGroup) ?? null;
  const groupBetIds = Array.from(new Set(messages
    .map((message) => message.betId)
    .filter((id): id is string => Boolean(id))));
  const unresolvedBetCount = groupBetIds
    .filter((id) => {
      const bet = betsById[id];
      return bet ? !isBetCompleted(bet) : true;
    })
    .length;
  const completedBets = groupBetIds
    .map((id) => betsById[id])
    .filter((bet): bet is Bet => Boolean(bet) && isBetCompleted(bet));
  const modalGroupMembers = useMemo(() => {
    const currentUsername = currentUser.username.trim().toLowerCase();
    const normalizedMembers = (activeGroupData?.memberUsernames ?? [])
      .map((value) => value.trim())
      .filter((value): value is string => Boolean(value) && value.toLowerCase() !== currentUsername);
    const seen = new Set<string>();
    const dedupedMembers: string[] = [];
    for (const member of normalizedMembers) {
      const key = member.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      dedupedMembers.push(member);
    }
    return dedupedMembers.map((name) => ({ name, initials: toInitials(name) }));
  }, [activeGroupData?.memberUsernames, currentUser.username]);
  useEffect(() => {
    activeGroupRef.current = activeGroup;
  }, [activeGroup]);

  useEffect(() => {
    lastReadByGroupRef.current = lastReadByGroup;
  }, [lastReadByGroup]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(unreadStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") return;
      const normalized = Object.fromEntries(
        Object.entries(parsed)
          .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
          .map(([groupId, value]) => [groupId, Number(value)]),
      ) as Record<string, number>;
      setLastReadByGroup(normalized);
    } catch {
      // ignore malformed local storage state
    }
  }, [unreadStorageKey]);

  function persistLastRead(next: Record<string, number>): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(unreadStorageKey, JSON.stringify(next));
  }

  function markGroupRead(groupId: string, readAt: number): void {
    if (!groupId) return;
    setUnreadByGroup((prev) => ({ ...prev, [groupId]: 0 }));
    setLastReadByGroup((prev) => {
      const nextReadAt = Math.max(prev[groupId] ?? 0, readAt);
      if (nextReadAt === (prev[groupId] ?? 0)) return prev;
      const next = { ...prev, [groupId]: nextReadAt };
      persistLastRead(next);
      return next;
    });
  }

  async function refreshUnreadCounts(nextGroups: Group[]): Promise<void> {
    if (nextGroups.length === 0) {
      setUnreadByGroup({});
      return;
    }
    const unreadEntries = await Promise.all(nextGroups.map(async (group) => {
      const { messages: groupMessages } = await getMessages(group.id);
      const lastReadAt = lastReadByGroupRef.current[group.id] ?? 0;
      const unread = groupMessages.filter((message) => {
        const createdAt = typeof message.createdAt === "number" ? message.createdAt : 0;
        const isOwnMessage = message.sender.toLowerCase() === currentUser.username.toLowerCase();
        return createdAt > lastReadAt && !isOwnMessage;
      }).length;
      return [group.id, unread] as const;
    }));
    const nextUnreadByGroup = Object.fromEntries(unreadEntries) as Record<string, number>;
    const selectedGroupId = activeGroupRef.current;
    if (selectedGroupId) nextUnreadByGroup[selectedGroupId] = 0;
    setUnreadByGroup(nextUnreadByGroup);
  }

  async function refreshGroupsAndBets(): Promise<void> {
    const [groupsRes, betsRes] = await Promise.all([getGroups(), getBets()]);
    const nextGroups = groupsRes.groups;
    setGroups(nextGroups);
    setBets(betsRes.bets);
    if (nextGroups.length === 0) {
      setActiveGroup("");
      setMessages([]);
    } else {
      setActiveGroup((previousGroupId) => (
        nextGroups.some((group) => group.id === previousGroupId)
          ? previousGroupId
          : nextGroups[0]!.id
      ));
    }
    void refreshUnreadCounts(nextGroups).catch(() => {});
  }

  async function refreshMessages(groupId: string, markRead = false): Promise<void> {
    const { messages: nextMessages } = await getMessages(groupId);
    setMessages(nextMessages);
    if (!markRead) return;
    const latestSeenAt = nextMessages.reduce(
      (max, message) => Math.max(max, typeof message.createdAt === "number" ? message.createdAt : 0),
      Date.now(),
    );
    markGroupRead(groupId, latestSeenAt);
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setRefreshError(null);
    void refreshGroupsAndBets()
      .catch((err) => {
        if (!alive) return;
        setRefreshError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    const interval = setInterval(() => {
      void refreshGroupsAndBets().catch(() => {});
    }, 3000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!activeGroup) return;
    markGroupRead(activeGroup, Date.now());
    void refreshMessages(activeGroup, true).catch(() => {});
    const interval = setInterval(() => {
      void refreshMessages(activeGroup, true).catch(() => {});
    }, 2000);
    return () => {
      clearInterval(interval);
    };
  }, [activeGroup]);
  useEffect(() => {
    if (!activeGroup || typeof window === "undefined") return;
    if (pendingRequestedBetIdRef.current) return;
    const frameId = window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: "end" });
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeGroup, messages.length]);

  useEffect(() => {
    const totalUnread = Object.values(unreadByGroup).reduce((sum, count) => sum + count, 0);
    onUnreadCountChange?.(totalUnread);
  }, [unreadByGroup, onUnreadCountChange]);

  useEffect(() => {
    setShowCompletedBets(false);
  }, [activeGroup]);

  async function sendMessage(): Promise<void> {
    const text = input.trim();
    if (!text || !activeGroup) return;
    setSending(true);
    try {
      await postMessage({
        groupId: activeGroup,
        text,
      });
      setInput("");
      await refreshMessages(activeGroup, true);
      void refreshGroupsAndBets();
    } finally {
      setSending(false);
    }
  }

  function handleSelectGroup(groupId: string): void {
    setActiveGroup(groupId);
    markGroupRead(groupId, Date.now());
  }

  useEffect(() => {
    if (!requestedGroupId || requestedGroupToken === undefined) return;
    if (lastHandledGroupRequestTokenRef.current === requestedGroupToken) return;
    if (!groups.some((group) => group.id === requestedGroupId)) return;
    lastHandledGroupRequestTokenRef.current = requestedGroupToken;
    pendingRequestedBetIdRef.current = requestedBetId ?? null;
    handleSelectGroup(requestedGroupId);
  }, [requestedGroupId, requestedBetId, requestedGroupToken, groups]);

  useEffect(() => {
    if (!activeGroup || typeof window === "undefined") return;
    const targetBetId = pendingRequestedBetIdRef.current;
    if (!targetBetId) return;
    if (!messages.some((message) => message.betId === targetBetId)) return;
    const targetNode = messageListRef.current?.querySelector<HTMLElement>(`[data-bet-id="${targetBetId}"]`);
    if (!targetNode) return;
    const frameId = window.requestAnimationFrame(() => {
      targetNode.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    pendingRequestedBetIdRef.current = null;
    setHighlightedBetId(targetBetId);
    const timeoutId = window.setTimeout(() => {
      setHighlightedBetId((current) => (current === targetBetId ? null : current));
    }, 1800);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [activeGroup, messages]);

  function openInputDialog(dialog: Extract<ChatDialog, { type: "create-group" | "add-member" }>): void {
    setDialogInput("");
    setDialogError(null);
    setChatDialog(dialog);
  }

  function showResult(title: string, description: string, tone: "success" | "error"): void {
    setDialogError(null);
    setChatDialog({ type: "result", title, description, tone });
  }

  async function submitInputDialog(): Promise<void> {
    const value = dialogInput.trim();
    if (!value || !chatDialog || (chatDialog.type !== "create-group" && chatDialog.type !== "add-member")) return;
    setDialogBusy(true);
    setDialogError(null);
    try {
      if (chatDialog.type === "create-group") {
        const { group } = await createGroup({ name: value });
        setActiveGroup(group.id);
        await refreshGroupsAndBets();
        await refreshMessages(group.id, true);
        setChatDialog(null);
        return;
      }
      if (!activeGroup) return;
      const result = await addGroupMemberByUsername(activeGroup, value);
      setGroups((prev) => prev.map((group) => (group.id === result.group.id ? result.group : group)));
      showResult(
        result.alreadyMember ? "Already a member" : "Member added",
        result.alreadyMember
          ? `@${result.addedUsername} is already in ${result.group.name}.`
          : `@${result.addedUsername} can now access ${result.group.name}.`,
        "success",
      );
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : String(err));
    } finally {
      setDialogBusy(false);
    }
  }

  function upsertBet(nextBet: Bet): void {
    setBets((prev) => prev.map((bet) => (bet.id === nextBet.id ? nextBet : bet)));
  }

  function handleVote(betId: string, votedFor: BetVoteChoice): void {
    const current = betsById[betId];
    if (!current || isBetCompleted(current) || current.status !== "ACTIVE") return;
    if (isBetParticipant(current, currentUser.username)) return;

    const candidateName = votedFor === "challenger" ? current.challenger : current.acceptor;
    const previousVote = getVotesByVoter(current)[currentUser.username];
    setChatDialog({
      type: "confirm-vote",
      betId,
      votedFor,
      candidateName,
      isChange: Boolean(previousVote && previousVote !== votedFor),
    });
  }

  function handleAccept(bet: Bet): void {
    setChatDialog({
      type: "confirm-accept",
      betId: bet.id,
      challenger: bet.challenger,
      stake: bet.stake,
      currency: bet.currency,
    });
  }

  async function submitAccept(dialog: Extract<ChatDialog, { type: "confirm-accept" }>): Promise<void> {
    setAcceptingByBetId((prev) => ({ ...prev, [dialog.betId]: true }));
    setDialogBusy(true);
    try {
      const { bet } = await acceptBet(dialog.betId);
      upsertBet(bet);
      setChatDialog(null);
      void refreshGroupsAndBets();
    } catch (err) {
      showResult("Acceptance failed", err instanceof Error ? err.message : String(err), "error");
    } finally {
      setDialogBusy(false);
      setAcceptingByBetId((prev) => {
        const next = { ...prev };
        delete next[dialog.betId];
        return next;
      });
    }
  }

  async function submitVote(dialog: Extract<ChatDialog, { type: "confirm-vote" }>): Promise<void> {
    const current = betsById[dialog.betId];
    if (!current || isBetCompleted(current)) return;
    const optimistic = applyVoteToBet(current, currentUser.username, dialog.votedFor);
    upsertBet(optimistic);
    setVotingByBetId((prev) => ({ ...prev, [dialog.betId]: true }));
    setDialogBusy(true);
    try {
      const { bet } = await voteBet({
        betId: dialog.betId,
        votedFor: dialog.votedFor,
      });
      upsertBet(bet);
      setChatDialog(null);
    } catch (err) {
      upsertBet(current);
      showResult("Vote failed", err instanceof Error ? err.message : String(err), "error");
    } finally {
      setDialogBusy(false);
      setVotingByBetId((prev) => {
        const next = { ...prev };
        delete next[dialog.betId];
        return next;
      });
    }
  }

  function handleSendBet(bet: NewBet): void {
    if (!activeGroup || !activeGroupData) return;
    const groupId = activeGroup;
    const currentUsername = currentUser.username.trim().toLowerCase();
    const recipientCandidates = (activeGroupData.memberUsernames ?? [])
      .map((username) => username.trim())
      .filter((username): username is string => Boolean(username) && username.toLowerCase() !== currentUsername);
    const normalizedAcceptorInput = bet.acceptor.trim().toLowerCase();
    const selectedRecipient = recipientCandidates.find(
      (username) => username.toLowerCase() === normalizedAcceptorInput,
    );
    const normalizedAcceptor = bet.sport
      ? (selectedRecipient ?? "anyone")
      : selectedRecipient;
    if (!normalizedAcceptor) {
      showResult(
        "Recipient required",
        "Pick a valid member of this group as the bet recipient.",
        "error",
      );
      return;
    }
    void createBet({
      groupId,
      type: bet.type,
      acceptor: normalizedAcceptor,
      terms: bet.terms.trim(),
      stake: bet.stake.trim(),
      currency: "SOL",
      // Quorum: at least 2 witnesses, and never fewer than 50% (rounded up).
      // e.g. 2->2, 3->2, 4->2, 5->3, 6->3.
      witnesses: Math.max(2, Math.ceil(activeGroupData.members / 2)),
      minBettors: 2,
      // Witness bets require a future resolve-by deadline (the relayer enforces this
      // and fires the unresolved fallback after it). Default to one week out.
      resolveByDate: Date.now() + 7 * 24 * 60 * 60 * 1000,
      // Sports bets: settled by the sports feed instead of witnesses.
      ...(bet.sport ? {
        sport: bet.sport,
        gameId: bet.gameId,
        backsHome: bet.backsHome,
        homeTeam: bet.homeTeam,
        awayTeam: bet.awayTeam,
      } : {}),
    })
      .then(async () => {
        await refreshMessages(groupId, true);
        await refreshGroupsAndBets();
      })
      .catch((err) => {
        showResult("Bet creation failed", err instanceof Error ? err.message : String(err), "error");
      });
  }

  return (
    <>
      <div className="flex h-full rounded-2xl border border-border overflow-hidden" style={{ background: "var(--card)" }}>
      <div className="w-64 flex flex-col shrink-0 border-r border-border" style={{ background: "var(--muted)" }}>
        <div className="px-4 py-3 border-b border-border">
          <Mono className="text-muted-foreground uppercase" style={{ fontSize: "9px", letterSpacing: "0.1em" } as React.CSSProperties}>
            Group Chats
          </Mono>
        </div>

        <div className="flex-1 overflow-y-auto py-1.5 space-y-0.5 px-1.5">
          {groups.map((group) => (
            <button
              key={group.id}
              onClick={() => handleSelectGroup(group.id)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-left transition-all duration-150 ${
                activeGroup === group.id ? "bg-primary/10" : "hover:bg-card"
              }`}
            >
              <div className="relative shrink-0">
                <Avatar initials={group.initials} size={34} />
                {group.pendingBet && (
                  <span
                    className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card"
                    style={{ background: "#FFB800" }}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`truncate ${activeGroup === group.id ? "text-primary" : "text-foreground"}`}
                    style={{ fontSize: "12px", fontWeight: 600 }}
                  >
                    {group.name}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {unreadByGroup[group.id] > 0 && activeGroup !== group.id && (
                      <span
                        className="min-w-4 h-4 px-1 rounded-full flex items-center justify-center text-[9px] font-bold"
                        style={{ background: "#FF4A4A", color: "#fff" }}
                      >
                        {unreadByGroup[group.id] > 99 ? "99+" : unreadByGroup[group.id]}
                      </span>
                    )}
                    <Mono className="text-muted-foreground shrink-0" style={{ fontSize: "9px" } as React.CSSProperties}>
                      {formatChatTime(group.updatedAt, group.time)}
                    </Mono>
                  </div>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <Users size={9} className="text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground truncate" style={{ fontSize: "11px" }}>
                    {group.members} · {group.lastMsg}
                  </span>
                </div>
              </div>
            </button>
          ))}
          {!loading && groups.length === 0 && (
            <p className="px-2 py-2 text-muted-foreground" style={{ fontSize: "11px" }}>
              No groups yet — create one to start chatting.
            </p>
          )}
        </div>

        <div className="p-2 border-t border-border">
          <button
            onClick={() => openInputDialog({ type: "create-group" })}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors"
            style={{ fontSize: "11px" }}
          >
            <Hash size={11} /> New Group
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <button
            type="button"
            onClick={() => setShowCompletedBets((value) => !value)}
            disabled={!activeGroupData}
            className="flex items-center gap-3 text-left disabled:cursor-not-allowed"
          >
            <Avatar initials={activeGroupData?.initials ?? "NA"} size={36} />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-foreground" style={{ fontSize: "14px", fontWeight: 700 }}>
                  {activeGroupData?.name ?? "No group selected"}
                </p>
                <ChevronRight
                  size={12}
                  className={`text-muted-foreground transition-transform ${showCompletedBets ? "rotate-90" : ""}`}
                />
                {activeGroupData && (
                  <Pill color="muted">
                    <CheckCircle2 size={8} />
                    {completedBets.length} COMPLETE
                  </Pill>
                )}
              </div>
              <p className="flex items-center gap-1.5 text-muted-foreground" style={{ fontSize: "11px" }}>
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "#14F195" }} />
                {activeGroupData ? `${activeGroupData.members} members · live` : "Create or select a group"}
              </p>
            </div>
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => openInputDialog({ type: "add-member", groupName: activeGroupData.name })}
              disabled={!activeGroupData}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontSize: "11px" }}
            >
              <UserPlus size={12} />
              Add user
            </button>
            {activeGroupData && (
              <Pill color={unresolvedBetCount > 0 ? "amber" : "muted"}>
                {unresolvedBetCount > 0 ? <AlertTriangle size={8} /> : <CheckCircle2 size={8} />}
                {unresolvedBetCount} OPEN BET{unresolvedBetCount === 1 ? "" : "S"}
              </Pill>
            )}
            <Pill color="amber">
              <AlertTriangle size={8} />
              {refreshError ? "SYNC ERROR" : "LIVE SYNC"}
            </Pill>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {showCompletedBets && activeGroupData && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="px-5 py-3 border-b border-border shrink-0 overflow-hidden"
            >
              <div className="rounded-xl border border-border bg-card/80 p-3 space-y-2">
                <p className="text-muted-foreground" style={{ fontSize: "11px", fontWeight: 600 }}>
                  Completed bets in {activeGroupData.name}
                </p>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {completedBets.length === 0 && (
                    <Mono className="text-muted-foreground block" style={{ fontSize: "10px" } as React.CSSProperties}>
                      No completed bets yet.
                    </Mono>
                  )}
                  {completedBets.map((bet) => {
                    const winner = getResolvedWinner(bet);
                    const winnerName = winner === "challenger"
                      ? bet.challenger
                      : winner === "acceptor"
                        ? bet.acceptor
                        : "pending";
                    const votes = countVotes(bet);
                    return (
                      <div key={bet.id} className="rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2">
                        <p className="text-foreground truncate" style={{ fontSize: "11px", fontWeight: 600 }}>
                          {bet.terms}
                        </p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
                            winner: {winnerName}
                          </Mono>
                          <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
                            votes {votes.challenger}-{votes.acceptor}
                          </Mono>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={messageListRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {!activeGroup && (
            <div className="h-full flex items-center justify-center">
              <Mono className="text-muted-foreground" style={{ fontSize: "11px" } as React.CSSProperties}>
                Pick a group to start.
              </Mono>
            </div>
          )}
          <AnimatePresence initial={false}>
            {messages.map((message, idx) => (
              <motion.div
                key={message.id}
                data-bet-id={message.betId ?? undefined}
                className={message.betId && highlightedBetId === message.betId
                  ? "rounded-xl ring-2 ring-primary/40 bg-primary/5 p-2"
                  : undefined}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: idx < 6 ? idx * 0.03 : 0 }}
              >
                <Message
                  msg={message}
                  bet={message.betId ? betsById[message.betId] : undefined}
                  voterName={currentUser.username}
                  onVote={handleVote}
                  onAccept={handleAccept}
                  isVoting={(betId) => Boolean(votingByBetId[betId])}
                  isAccepting={(betId) => Boolean(acceptingByBetId[betId])}
                />
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={bottomRef} />
        </div>

        <div className="px-5 py-3.5 border-t border-border shrink-0">
          <div className="flex items-center gap-2">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.93 }}
              onClick={() => setBetModalOpen(true)}
              disabled={!activeGroupData}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border font-semibold shrink-0 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                fontSize: "11px",
                color: "#9945FF",
                borderColor: "rgba(153,69,255,0.35)",
                background: "rgba(153,69,255,0.08)",
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: "0.04em",
                whiteSpace: "nowrap",
              }}
            >
              <Plus size={11} />
              New Bet
            </motion.button>

            <div
              className="flex-1 flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border transition-all duration-150"
              style={{ background: "var(--muted)" }}
            >
              <Paperclip size={14} className="text-muted-foreground shrink-0" />
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                disabled={!activeGroup || sending}
                placeholder={activeGroupData ? `Message ${activeGroupData.name}…` : "Create a group first…"}
                className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none min-w-0"
                style={{ fontSize: "13px" }}
              />
              <Smile size={14} className="text-muted-foreground shrink-0" />
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.94 }}
                onClick={() => { void sendMessage(); }}
                disabled={!activeGroup || !input.trim() || sending}
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                style={{ background: input.trim() && activeGroup ? "var(--primary)" : "var(--border)" }}
              >
                <Send size={12} className={input.trim() && activeGroup ? "text-white" : "text-muted-foreground"} />
              </motion.button>
            </div>
          </div>
        </div>
      </div>
      </div>
      <SendBetModal
        open={betModalOpen}
        onClose={() => setBetModalOpen(false)}
        onSend={handleSendBet}
        groupName={activeGroupData?.name ?? "No group selected"}
        groupMembers={modalGroupMembers}
      />
      <Dialog
        open={Boolean(chatDialog)}
        onOpenChange={(open) => {
          if (!open && !dialogBusy) {
            setChatDialog(null);
            setDialogError(null);
          }
        }}
      >
        <DialogContent className="overflow-hidden border-border bg-card p-0 shadow-2xl sm:max-w-md">
          {chatDialog && (
            <>
              <div
                className="h-1 w-full"
                style={{
                  background: chatDialog.type === "result" && chatDialog.tone === "error"
                    ? "#ef4444"
                    : "linear-gradient(90deg, #9945FF, #14F195)",
                }}
              />
              <div className="p-6">
                <DialogHeader className="pr-6">
                  <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    {chatDialog.type === "add-member" ? <UserPlus size={18} /> :
                      chatDialog.type === "confirm-accept" ? <CheckCircle2 size={18} /> :
                      chatDialog.type === "confirm-vote" ? <Shield size={18} /> :
                        chatDialog.type === "result" && chatDialog.tone === "error" ? <AlertCircle size={18} /> :
                          chatDialog.type === "result" ? <CheckCircle2 size={18} /> : <Users size={18} />}
                  </div>
                  <DialogTitle className="text-foreground">
                    {chatDialog.type === "create-group" ? "Create a group" :
                      chatDialog.type === "add-member" ? "Add a member" :
                        chatDialog.type === "confirm-accept" ? "Accept this challenge?" :
                        chatDialog.type === "confirm-vote" ? (chatDialog.isChange ? "Change your vote?" : "Confirm your vote") :
                          chatDialog.title}
                  </DialogTitle>
                  <DialogDescription>
                    {chatDialog.type === "create-group" ? "Start a private chat. Only members you add will be able to see it." :
                      chatDialog.type === "add-member" ? `Invite a registered user to ${chatDialog.groupName}.` :
                        chatDialog.type === "confirm-accept" ? `Accept ${chatDialog.challenger}'s challenge and commit ${chatDialog.stake} ${chatDialog.currency}.` :
                        chatDialog.type === "confirm-vote" ? `Submit your vote for ${chatDialog.candidateName}. This may resolve the bet once quorum is reached.` :
                          chatDialog.description}
                  </DialogDescription>
                </DialogHeader>

                {(chatDialog.type === "create-group" || chatDialog.type === "add-member") && (
                  <form
                    className="mt-5 space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitInputDialog();
                    }}
                  >
                    <Input
                      autoFocus
                      value={dialogInput}
                      onChange={(event) => setDialogInput(event.target.value)}
                      placeholder={chatDialog.type === "create-group" ? "e.g. Weekend Builders" : "Enter username"}
                      className="h-11 rounded-xl bg-muted"
                      disabled={dialogBusy}
                    />
                    {dialogError && (
                      <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-destructive">
                        <AlertCircle size={14} className="mt-0.5 shrink-0" />
                        <span className="text-xs">{dialogError}</span>
                      </div>
                    )}
                    <DialogFooter className="pt-2">
                      <Button type="button" variant="outline" onClick={() => setChatDialog(null)} disabled={dialogBusy}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={!dialogInput.trim() || dialogBusy}>
                        {dialogBusy ? "Working..." : chatDialog.type === "create-group" ? "Create group" : "Add member"}
                      </Button>
                    </DialogFooter>
                  </form>
                )}

                {chatDialog.type === "confirm-vote" && (
                  <DialogFooter className="mt-6">
                    <Button variant="outline" onClick={() => setChatDialog(null)} disabled={dialogBusy}>
                      Cancel
                    </Button>
                    <Button onClick={() => { void submitVote(chatDialog); }} disabled={dialogBusy}>
                      {dialogBusy ? "Submitting..." : `Vote for ${chatDialog.candidateName}`}
                    </Button>
                  </DialogFooter>
                )}

                {chatDialog.type === "confirm-accept" && (
                  <DialogFooter className="mt-6">
                    <Button variant="outline" onClick={() => setChatDialog(null)} disabled={dialogBusy}>
                      Cancel
                    </Button>
                    <Button onClick={() => { void submitAccept(chatDialog); }} disabled={dialogBusy}>
                      {dialogBusy ? "Accepting..." : "Accept challenge"}
                    </Button>
                  </DialogFooter>
                )}

                {chatDialog.type === "result" && (
                  <DialogFooter className="mt-6">
                    <Button onClick={() => setChatDialog(null)}>Done</Button>
                  </DialogFooter>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
