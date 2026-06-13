import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Send, Paperclip, Hash, Users, AlertTriangle, Smile, Plus,
  CheckCircle2, Clock, UserPlus, ChevronRight, Zap, Shield,
} from "lucide-react";
import { Avatar, Pill, Mono } from "./ui";
import { SendBetModal, type NewBet } from "./SendBetModal";
import {
  addGroupMemberByUsername,
  createGroup,
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

function applyVoteToBet(bet: Bet, voter: string, votedFor: BetVoteChoice): Bet {
  if (isBetCompleted(bet)) return bet;
  const nextVotesByVoter: Record<string, BetVoteChoice> = {
    ...getVotesByVoter(bet),
    [voter]: votedFor,
  };
  const nextBet: Bet = {
    ...bet,
    votesByVoter: nextVotesByVoter,
  };
  const winner = getResolvedWinner(nextBet);
  const votes = countVotes(nextBet);
  return {
    ...nextBet,
    status: winner
      ? "COMPLETED"
      : bet.status === "PENDING" && votes.total > 0
        ? "ACTIVE"
        : bet.status,
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

function BetTypeTag({ type }: { type: Bet["type"] }) {
  return (
    <Pill color={type === "DEV" ? "teal" : "purple"}>
      {type === "DEV" ? <Zap size={8} /> : <Shield size={8} />}
      BET TYPE: {type}
    </Pill>
  );
}

function EmbeddedBetCard({
  bet,
  voterName,
  isVoting,
  onVote,
}: {
  bet: Bet;
  voterName: string;
  isVoting: boolean;
  onVote: (betId: string, votedFor: BetVoteChoice) => void;
}) {
  const votes = countVotes(bet);
  const witnessThreshold = Math.max(1, Number(bet.witnesses) || 1);
  const winner = getResolvedWinner(bet);
  const isResolved = isBetCompleted(bet);
  const winnerName = winner === "challenger" ? bet.challenger : bet.acceptor;
  const myVote = getVotesByVoter(bet)[voterName];
  const quorumPct = Math.min(100, (votes.total / witnessThreshold) * 100);
  const canVote = !isResolved && !winner && !isVoting;

  return (
    <div className="w-full max-w-[420px] rounded-2xl border border-border overflow-hidden bg-card">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <BetTypeTag type={bet.type} />
        <StatusTag status={bet.status} />
      </div>

      <div className="px-4 pt-4 pb-3">
        <p className="text-foreground leading-snug" style={{ fontSize: "15px", fontWeight: 600 }}>
          "{bet.terms}"
        </p>
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
            witnesses decide outcome
          </span>
        </div>
      </div>

      <div className="px-4 pb-3 flex items-center justify-between">
        <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
          quorum {witnessThreshold} · votes {votes.challenger}-{votes.acceptor}
        </Mono>
        <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
          #{bet.id.toUpperCase()}
        </Mono>
      </div>

      <div className="px-4 pb-4 space-y-2.5">
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

        {winner || isResolved ? (
          <div className="rounded-lg px-3 py-2 border border-[#14F195]/25 bg-[#14F195]/8">
            <span className="text-[#14F195]" style={{ fontSize: "11px", fontWeight: 700 }}>
              {winner ? `Completed — winner: ${winnerName}` : "Completed"}
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
    </div>
  );
}

function Message({
  msg,
  bet,
  voterName,
  onVote,
  isVoting,
}: {
  msg: Msg;
  bet?: Bet;
  voterName: string;
  onVote: (betId: string, votedFor: BetVoteChoice) => void;
  isVoting: (betId: string) => boolean;
}) {
  if (msg.system && bet) {
    return (
      <div className="flex flex-col gap-1.5">
        <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
          system card · {msg.ts}
        </Mono>
        <EmbeddedBetCard
          bet={bet}
          voterName={voterName}
          onVote={onVote}
          isVoting={isVoting(bet.id)}
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
          <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>{msg.ts}</Mono>
        </div>
        <p className="text-foreground/85 leading-relaxed" style={{ fontSize: "14px" }}>{msg.text}</p>
      </div>
    </div>
  );
}

export function ChatView({ currentUser }: { currentUser: AuthUser }) {
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
  const bottomRef = useRef<HTMLDivElement>(null);

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
    const normalizedMembers = (activeGroupData?.memberUsernames ?? [])
      .map((value) => value.trim())
      .filter((value): value is string => Boolean(value));
    const seen = new Set<string>();
    const dedupedMembers: string[] = [];
    for (const member of normalizedMembers) {
      const key = member.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      dedupedMembers.push(member);
    }
    const currentUsername = currentUser.username.trim();
    if (currentUsername && !seen.has(currentUsername.toLowerCase())) {
      dedupedMembers.unshift(currentUsername);
    }
    if (dedupedMembers.length === 0) {
      dedupedMembers.push(currentUser.username);
    }
    return dedupedMembers.map((name) => ({ name, initials: toInitials(name) }));
  }, [activeGroupData?.memberUsernames, currentUser.username]);

  async function refreshGroupsAndBets(): Promise<void> {
    const [groupsRes, betsRes] = await Promise.all([getGroups(), getBets()]);
    const nextGroups = groupsRes.groups;
    setGroups(nextGroups);
    setBets(betsRes.bets);
    if (nextGroups.length > 0) {
      if (!nextGroups.some((group) => group.id === activeGroup)) {
        setActiveGroup(nextGroups[0]!.id);
      }
    } else {
      setActiveGroup("");
      setMessages([]);
    }
  }

  async function refreshMessages(groupId: string): Promise<void> {
    const { messages } = await getMessages(groupId);
    setMessages(messages);
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
    void refreshMessages(activeGroup).catch(() => {});
    const interval = setInterval(() => {
      void refreshMessages(activeGroup).catch(() => {});
    }, 2000);
    return () => {
      clearInterval(interval);
    };
  }, [activeGroup]);

  useEffect(() => {
    setShowCompletedBets(false);
  }, [activeGroup]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(): Promise<void> {
    const text = input.trim();
    if (!text || !activeGroup) return;
    setSending(true);
    try {
      await postMessage({
        groupId: activeGroup,
        sender: currentUser.username,
        initials: currentUser.initials,
        text,
      });
      setInput("");
      await refreshMessages(activeGroup);
      void refreshGroupsAndBets();
    } finally {
      setSending(false);
    }
  }

  async function handleCreateGroup(): Promise<void> {
    const name = window.prompt("New group name");
    if (!name || !name.trim()) return;
    const { group } = await createGroup({
      name: name.trim(),
      members: 1,
      creatorUsername: currentUser.username,
    });
    setActiveGroup(group.id);
    await refreshGroupsAndBets();
    await refreshMessages(group.id);
  }

  async function handleAddUserToGroup(): Promise<void> {
    if (!activeGroup || !activeGroupData) return;
    const username = window.prompt(`Add which username to ${activeGroupData.name}?`);
    if (!username || !username.trim()) return;
    const result = await addGroupMemberByUsername(activeGroup, username.trim());
    setGroups((prev) => prev.map((group) => (group.id === result.group.id ? result.group : group)));
    window.alert(
      result.alreadyMember
        ? `@${result.addedUsername} is already in this group.`
        : `Added @${result.addedUsername} to ${result.group.name}.`,
    );
  }

  function upsertBet(nextBet: Bet): void {
    setBets((prev) => prev.map((bet) => (bet.id === nextBet.id ? nextBet : bet)));
  }

  async function handleVote(betId: string, votedFor: BetVoteChoice): Promise<void> {
    const current = betsById[betId];
    if (!current || isBetCompleted(current)) return;

    const candidateName = votedFor === "challenger" ? current.challenger : current.acceptor;
    const previousVote = getVotesByVoter(current)[currentUser.username];
    const firstPrompt = previousVote && previousVote !== votedFor
      ? `Change your vote to ${candidateName}?`
      : `Vote for ${candidateName}?`;
    if (!window.confirm(firstPrompt)) return;
    if (!window.confirm(`Final confirmation: submit vote for ${candidateName}.`)) return;

    const optimistic = applyVoteToBet(current, currentUser.username, votedFor);
    upsertBet(optimistic);
    setVotingByBetId((prev) => ({ ...prev, [betId]: true }));
    try {
      const { bet } = await voteBet({
        betId,
        voter: currentUser.username,
        votedFor,
      });
      upsertBet(bet);
    } catch {
      upsertBet(current);
    } finally {
      setVotingByBetId((prev) => {
        const next = { ...prev };
        delete next[betId];
        return next;
      });
    }
  }

  function handleSendBet(bet: NewBet): void {
    if (!activeGroup || !activeGroupData) return;
    const messageText = bet.type === "DEV"
      ? `🔥 New dev bet: ${bet.terms} · Stake: ${bet.stake} ${bet.currency}`
      : `🎯 New personal bet vs ${bet.acceptor}: ${bet.terms} · Stake: ${bet.stake} ${bet.currency}`;
    const groupId = activeGroup;
    void postMessage({
      groupId,
      sender: currentUser.username,
      initials: currentUser.initials,
      text: messageText,
    })
      .then(async () => {
        await refreshMessages(groupId);
        await refreshGroupsAndBets();
      })
      .catch((err) => {
        window.alert(`Failed to post bet: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  return (
    <>
      <div className="flex h-full rounded-2xl border border-border overflow-hidden" style={{ background: "var(--card)" }}>
      <div className="w-60 flex flex-col shrink-0 border-r border-border" style={{ background: "var(--muted)" }}>
        <div className="px-4 py-3 border-b border-border">
          <Mono className="text-muted-foreground uppercase" style={{ fontSize: "9px", letterSpacing: "0.1em" } as React.CSSProperties}>
            Group Chats
          </Mono>
        </div>

        <div className="flex-1 overflow-y-auto py-1.5 space-y-0.5 px-1.5">
          {groups.map((group) => (
            <button
              key={group.id}
              onClick={() => setActiveGroup(group.id)}
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
                  <Mono className="text-muted-foreground shrink-0" style={{ fontSize: "9px" } as React.CSSProperties}>
                    {group.time}
                  </Mono>
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
            onClick={() => { void handleCreateGroup(); }}
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
              onClick={() => { void handleAddUserToGroup(); }}
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

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
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
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: idx < 6 ? idx * 0.03 : 0 }}
              >
                <Message msg={message} bet={message.betId ? betsById[message.betId] : undefined} />
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
    </>
  );
}