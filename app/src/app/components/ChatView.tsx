import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Send, Paperclip, Hash, Users, AlertTriangle, Smile, Plus,
  CheckCircle2, Clock, UserPlus,
} from "lucide-react";
import { Avatar, Pill, Mono } from "./ui";
import {
  addGroupMemberByUsername,
  createGroup,
  getBets,
  getGroups,
  getMessages,
  postMessage,
  type AuthUser,
  type Bet,
  type ChatMessage,
  type Group,
} from "../../lib/relayer";

type Msg = ChatMessage;

function StatusTag({ status }: { status: Bet["status"] }) {
  const map = {
    PENDING: { color: "amber" as const, icon: Clock },
    ACTIVE: { color: "teal" as const, icon: CheckCircle2 },
    RESOLVED: { color: "muted" as const, icon: AlertTriangle },
  };
  const meta = map[status] ?? map.PENDING;
  const Icon = meta.icon;
  return (
    <Pill color={meta.color}>
      <Icon size={8} />
      {status}
    </Pill>
  );
}

function EmbeddedBetCard({ bet }: { bet: Bet }) {
  return (
    <div className="w-full max-w-[420px] rounded-2xl border border-border overflow-hidden bg-card">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <Pill color={bet.type === "DEV" ? "teal" : "purple"}>
          BET TYPE: {bet.type}
        </Pill>
        <StatusTag status={bet.status} />
      </div>
      <div className="px-4 py-3">
        <p className="text-foreground leading-snug" style={{ fontSize: "15px", fontWeight: 600 }}>
          "{bet.terms}"
        </p>
        <Mono className="text-muted-foreground mt-2 block" style={{ fontSize: "10px" } as React.CSSProperties}>
          STAKE: {bet.stake} {bet.currency}
        </Mono>
      </div>
    </div>
  );
}

function Message({ msg, bet }: { msg: Msg; bet?: Bet }) {
  if (msg.system && bet) {
    return (
      <div className="flex flex-col gap-1.5">
        <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
          system card · {msg.ts}
        </Mono>
        <EmbeddedBetCard bet={bet} />
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
  const [groups, setGroups] = useState<Group[]>([]);
  const [bets, setBets] = useState<Bet[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const betsById = useMemo(
    () => Object.fromEntries(bets.map((bet) => [bet.id, bet])) as Record<string, Bet>,
    [bets],
  );
  const activeGroupData = groups.find((group) => group.id === activeGroup) ?? null;

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

  return (
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
          <div className="flex items-center gap-3">
            <Avatar initials={activeGroupData?.initials ?? "NA"} size={36} />
            <div>
              <p className="text-foreground" style={{ fontSize: "14px", fontWeight: 700 }}>
                {activeGroupData?.name ?? "No group selected"}
              </p>
              <p className="flex items-center gap-1.5 text-muted-foreground" style={{ fontSize: "11px" }}>
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "#14F195" }} />
                {activeGroupData ? `${activeGroupData.members} members · live` : "Create or select a group"}
              </p>
            </div>
          </div>
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
            <Pill color="amber">
              <AlertTriangle size={8} />
              {refreshError ? "SYNC ERROR" : "LIVE SYNC"}
            </Pill>
          </div>
        </div>

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
            <button
              onClick={() => { void handleCreateGroup(); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border font-semibold shrink-0 transition-all duration-150"
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
              New Group
            </button>

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
  );
}