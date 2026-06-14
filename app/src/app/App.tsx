/* MARKER-MAKE-KIT-INVOKED */
import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  MessageSquare, Shield, GitBranch, BarChart3,
  Zap, Sun, Moon, Bell, ChevronRight
} from "lucide-react";
import { Mono, Avatar, Pill } from "./components/ui";
import { ChatView }        from "./components/ChatView";
import { EscrowView }      from "./components/EscrowView";
import { GitView }         from "./components/GitView";
import { LeaderboardView } from "./components/LeaderboardView";
import { useRelayerHealth } from "../lib/useRelayer";
import {
  AUTH_TOKEN_STORAGE_KEY,
  getCurrentAuthUser,
  getGroups,
  getProfileSummary,
  loginWithEmail,
  signupWithEmail,
  type AuthUser,
  type ProfileSummary,
} from "../lib/relayer";
import {
  countUnreadGroupNotifications,
  markAllGroupNotificationsRead,
  mergeGroupNotifications,
  parseStoredGroupNotifications,
  parseStoredStringArray,
  type GroupNotification,
} from "../lib/groupNotifications";

/* ── Navigation config ─────────────────────────────────── */
type ViewId = "chat" | "escrow" | "git" | "leaderboard";

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

const NAV: {
  id:       ViewId;
  label:    string;
  sublabel: string;
  Icon:     React.FC<{ size?: number; className?: string }>;
  badge?:   string | undefined;
}[] = [
  { id:"chat",        label:"Group Chat",   sublabel:"Lobby & Bets",     Icon:MessageSquare },
  { id:"escrow",      label:"Escrow Card",  sublabel:"P2P Wager Mode",   Icon:Shield },
  { id:"git",         label:"Dev Bet",      sublabel:"AI Git Inspector", Icon:GitBranch },
  { id:"leaderboard", label:"Leaderboard",  sublabel:"Rankings & Stats", Icon:BarChart3 },
];

/* ── Global status bar ─────────────────────────────────── */
function StatusBar() {
  // Live state from the relayer (/health). Falls back to a "disconnected"
  // indicator when the relayer isn't running so the dashboard still renders.
  const { connected, loading, health } = useRelayerHealth();

  const dot = connected ? "#14F195" : loading ? "#FFB800" : "#FF4A4A";
  const conn = connected ? "CONNECTED" : loading ? "CONNECTING…" : "RELAYER OFFLINE";

  return (
    <div
      className="h-7 border-t border-border flex items-center px-4 justify-between shrink-0"
      style={{ background: "var(--muted)" }}
    >
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <motion.span
            className="w-1.5 h-1.5 rounded-full inline-block"
            animate={connected ? { opacity: [1, 0.4, 1] } : { opacity: 1 }}
            transition={{ repeat: Infinity, duration: 2 }}
            style={{ background: dot }}
          />
          <Mono className="text-muted-foreground" style={{ fontSize: "9px" } as React.CSSProperties}>
            SOLANA DEVNET · {conn}
          </Mono>
        </div>
        <div className="h-3 w-px bg-border" />
        <Mono className="text-muted-foreground" style={{ fontSize: "9px" } as React.CSSProperties}>
          BLOCK #{health ? health.slot.toLocaleString() : "—"}
        </Mono>
        <div className="h-3 w-px bg-border" />
        <Mono className="text-muted-foreground" style={{ fontSize: "9px" } as React.CSSProperties}>
          {health ? `ORACLE ${health.oracle.slice(0, 4)}…${health.oracle.slice(-4)}` : "ORACLE —"}
        </Mono>
      </div>
      <Mono className="text-muted-foreground" style={{ fontSize: "9px" } as React.CSSProperties}>
        COMMIT{" "}
        <a
          href={`https://github.com/BansonVuong/solana-accountabilibuddy/commit/${__GIT_COMMIT__}`}
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-foreground transition-colors"
        >
          {__GIT_COMMIT__}
        </a>
      </Mono>
    </div>
  );
}

/* ── App shell ─────────────────────────────────────────── */
export default function App() {
  const [dark,       setDark]       = useState(true);
  const [activeView, setActiveView] = useState<ViewId>("chat");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authMode, setAuthMode] = useState<"signup" | "login">("signup");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [chatSelectionRequest, setChatSelectionRequest] = useState<{ groupId: string; token: number } | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [groupNotifications, setGroupNotifications] = useState<GroupNotification[]>([]);
  const [authForm, setAuthForm] = useState({
    email: "",
    username: "",
    password: "",
  });
  const chatSeenUpdatedAtByGroupRef = useRef<Record<string, number>>({});
  const previousViewRef = useRef<ViewId>("chat");

  /* Apply dark class to <html> */
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    let alive = true;
    const token = typeof window === "undefined"
      ? null
      : window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (!token) {
      setAuthReady(true);
      return () => { alive = false; };
    }
    getCurrentAuthUser()
      .then(({ user }) => {
        if (!alive) return;
        setAuthUser(user);
      })
      .catch(() => {
        if (!alive || typeof window === "undefined") return;
        window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      })
      .finally(() => {
        if (alive) setAuthReady(true);
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!authUser) return;

    let alive = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const previousView = previousViewRef.current;
    const justLeftChat = previousView === "chat" && activeView !== "chat";
    previousViewRef.current = activeView;

    function toSeenMap(groups: Array<{ id: string; updatedAt?: number }>): Record<string, number> {
      const nextSeenByGroup: Record<string, number> = {};
      for (const group of groups) {
        nextSeenByGroup[group.id] = Number.isFinite(group.updatedAt) ? Number(group.updatedAt) : 0;
      }
      return nextSeenByGroup;
    }

    async function markChatSeen(): Promise<void> {
      try {
        const { groups } = await getGroups();
        if (!alive) return;
        chatSeenUpdatedAtByGroupRef.current = toSeenMap(groups);
        setChatUnreadCount(0);
      } catch {
        // Ignore transient relayer/network errors for badge polling.
      }
    }

    async function refreshUnreadCount(): Promise<void> {
      try {
        const { groups } = await getGroups();
        if (!alive) return;
        const unread = groups.reduce((count, group) => {
          const lastSeen = chatSeenUpdatedAtByGroupRef.current[group.id] ?? 0;
          const updatedAt = Number.isFinite(group.updatedAt) ? Number(group.updatedAt) : 0;
          return updatedAt > lastSeen ? count + 1 : count;
        }, 0);
        setChatUnreadCount(unread);
      } catch {
        // Ignore transient relayer/network errors for badge polling.
      }
    }

    if (activeView === "chat") {
      void markChatSeen();
      intervalId = setInterval(() => {
        void markChatSeen();
      }, 3000);
    } else if (justLeftChat) {
      void markChatSeen();
      intervalId = setInterval(() => {
        void refreshUnreadCount();
      }, 3000);
    } else {
      void refreshUnreadCount();
      intervalId = setInterval(() => {
        void refreshUnreadCount();
      }, 3000);
    }

    return () => {
      alive = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [activeView, authUser]);

  const nav = NAV.map((item) => {
    if (item.id !== "chat") return item;
    return {
      ...item,
      badge: chatUnreadCount > 0 ? String(chatUnreadCount > 99 ? "99+" : chatUnreadCount) : undefined,
    };
  });
  const activeNav = nav.find((n) => n.id === activeView)!;
  const groupNotificationStorageKey = authUser
    ? `accountabilibuddy_group_notifications_${authUser.username.toLowerCase()}`
    : null;
  const seenGroupsStorageKey = authUser
    ? `accountabilibuddy_seen_group_ids_${authUser.username.toLowerCase()}`
    : null;
  const sortedGroupNotifications = useMemo(
    () => [...groupNotifications].sort((a, b) => b.createdAt - a.createdAt),
    [groupNotifications],
  );
  const unreadNotificationCount = useMemo(
    () => countUnreadGroupNotifications(groupNotifications),
    [groupNotifications],
  );

  useEffect(() => {
    if (!authUser || typeof window === "undefined" || !groupNotificationStorageKey || !seenGroupsStorageKey) {
      setGroupNotifications([]);
      return;
    }

    let alive = true;
    let seenGroupIds = new Set(parseStoredStringArray(window.localStorage.getItem(seenGroupsStorageKey)));
    const restored = parseStoredGroupNotifications(window.localStorage.getItem(groupNotificationStorageKey));
    setGroupNotifications(restored);

    function persistNotifications(next: GroupNotification[]): void {
      window.localStorage.setItem(groupNotificationStorageKey, JSON.stringify(next.slice(0, 50)));
    }

    async function refreshGroupNotifications(): Promise<void> {
      try {
        const { groups } = await getGroups();
        if (!alive) return;
        const isFirstSync = seenGroupIds.size === 0 && restored.length === 0;
        setGroupNotifications((prev) => {
          const next = mergeGroupNotifications(prev, groups, isFirstSync, seenGroupIds);
          persistNotifications(next);
          return next;
        });
        for (const group of groups) {
          seenGroupIds.add(group.id);
        }
        window.localStorage.setItem(seenGroupsStorageKey, JSON.stringify(Array.from(seenGroupIds)));
      } catch {
        // keep current notification state on transient errors
      }
    }

    void refreshGroupNotifications();
    const interval = window.setInterval(() => {
      void refreshGroupNotifications();
    }, 5000);

    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [authUser, groupNotificationStorageKey, seenGroupsStorageKey]);

  function markAllNotificationsRead(): void {
    if (!groupNotificationStorageKey || typeof window === "undefined") return;
    const now = Date.now();
    setGroupNotifications((prev) => {
      const { notifications: next, changed } = markAllGroupNotificationsRead(prev, now);
      if (changed) {
        window.localStorage.setItem(groupNotificationStorageKey, JSON.stringify(next));
      }
      return next;
    });
  }

  function toggleNotifications(): void {
    const nextOpen = !notificationsOpen;
    setNotificationsOpen(nextOpen);
    if (nextOpen) {
      setProfileOpen(false);
      markAllNotificationsRead();
    }
  }

  function openBetInChat(groupId: string): void {
    setChatSelectionRequest((previous) => ({
      groupId,
      token: (previous?.token ?? 0) + 1,
    }));
    setActiveView("chat");
  }

  async function submitAuth(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      const result = authMode === "signup"
        ? await signupWithEmail({
            email: authForm.email,
            username: authForm.username,
            password: authForm.password,
          })
        : await loginWithEmail({
            email: authForm.email,
            password: authForm.password,
          });
      if (typeof window !== "undefined") {
        window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, result.token);
      }
      setAuthUser(result.user);
      setAuthForm({ email: "", username: "", password: "" });
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthLoading(false);
    }
  }

  function logout(): void {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
    setAuthUser(null);
    setChatUnreadCount(0);
    setProfile(null);
    setProfileOpen(false);
    setNotificationsOpen(false);
    setGroupNotifications([]);
    setAuthMode("login");
  }

  async function toggleProfile(): Promise<void> {
    const nextOpen = !profileOpen;
    setProfileOpen(nextOpen);
    if (nextOpen) setNotificationsOpen(false);
    if (!nextOpen) return;

    setProfileLoading(true);
    setProfileError(null);
    try {
      const nextProfile = await getProfileSummary();
      setProfile(nextProfile);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : String(err));
    } finally {
      setProfileLoading(false);
    }
  }

  if (!authReady) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--background)", fontFamily: "'Inter', -apple-system, sans-serif" }}
      >
        <Mono className="text-muted-foreground" style={{ fontSize: "11px" } as React.CSSProperties}>
          Restoring session…
        </Mono>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4"
        style={{ background: "var(--background)", fontFamily: "'Inter', -apple-system, sans-serif" }}
      >
        <form
          onSubmit={(event) => { void submitAuth(event); }}
          className="w-full max-w-sm rounded-2xl border border-border p-5"
          style={{ background: "var(--card)" }}
        >
          <div className="mb-4">
            <p className="text-foreground" style={{ fontSize: "20px", fontWeight: 700 }}>
              {authMode === "signup" ? "Create account" : "Sign in"}
            </p>
            <p className="text-muted-foreground mt-1" style={{ fontSize: "12px" }}>
              Use your own email and username.
            </p>
          </div>

          <label className="block text-muted-foreground mb-1" style={{ fontSize: "11px" }}>Email</label>
          <input
            required
            type="email"
            value={authForm.email}
            onChange={(event) => setAuthForm((prev) => ({ ...prev, email: event.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-foreground outline-none mb-3"
            style={{ fontSize: "13px" }}
            placeholder="you@email.com"
          />

          {authMode === "signup" && (
            <>
              <label className="block text-muted-foreground mb-1" style={{ fontSize: "11px" }}>Username</label>
              <input
                required
                type="text"
                value={authForm.username}
                onChange={(event) => setAuthForm((prev) => ({ ...prev, username: event.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-foreground outline-none mb-3"
                style={{ fontSize: "13px" }}
                placeholder="your_username"
              />
            </>
          )}

          <label className="block text-muted-foreground mb-1" style={{ fontSize: "11px" }}>Password</label>
          <input
            required
            type="password"
            value={authForm.password}
            onChange={(event) => setAuthForm((prev) => ({ ...prev, password: event.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-foreground outline-none"
            style={{ fontSize: "13px" }}
            placeholder="At least 8 characters"
          />

          {authError && (
            <p className="mt-3 text-[#FF4A4A]" style={{ fontSize: "11px" }}>
              {authError}
            </p>
          )}

          <button
            type="submit"
            disabled={authLoading}
            className="mt-4 w-full px-3 py-2 rounded-lg text-white transition-opacity"
            style={{ background: "var(--primary)", opacity: authLoading ? 0.7 : 1, fontSize: "13px", fontWeight: 600 }}
          >
            {authLoading ? "Please wait…" : authMode === "signup" ? "Create account" : "Sign in"}
          </button>

          <button
            type="button"
            onClick={() => {
              setAuthError(null);
              setAuthMode((prev) => (prev === "signup" ? "login" : "signup"));
            }}
            className="mt-3 w-full text-muted-foreground hover:text-foreground transition-colors"
            style={{ fontSize: "12px" }}
          >
            {authMode === "signup" ? "Already have an account? Sign in" : "Need an account? Sign up"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col min-h-screen"
      style={{ background: "var(--background)", fontFamily: "'Inter', -apple-system, sans-serif" }}
    >

      {/* ═══ Top navigation bar ══════════════════════ */}
      <header
        className="h-12 border-b border-border flex items-center px-4 gap-4 shrink-0 sticky top-0 z-50"
        style={{
          background: dark ? "rgba(11,15,25,0.85)" : "rgba(248,250,252,0.9)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, #9945FF, #7B35FF)",
              boxShadow: "0 0 12px rgba(153,69,255,0.4)",
            }}
          >
            <Zap size={13} className="text-white" />
          </div>
          <span className="text-foreground" style={{ fontSize: "13px", fontWeight: 700, letterSpacing: "-0.01em" }}>
            AccountabiliBuddy
          </span>
          <Pill color="teal" className="hidden sm:inline-flex">BETA</Pill>
        </div>

        {/* Nav tabs */}
        <nav className="flex-1 flex items-center justify-center">
          <div
            className="flex items-center gap-0.5 p-0.5 rounded-xl border border-border"
            style={{ background: "var(--muted)" }}
          >
            {nav.map(({ id, label, Icon, badge }) => {
              const active = activeView === id;
              return (
                <button
                  key={id}
                  onClick={() => setActiveView(id)}
                  className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] transition-colors duration-150"
                  style={{
                    fontSize: "12px",
                    fontWeight: active ? 600 : 400,
                    color: active ? "var(--primary-foreground)" : "var(--muted-foreground)",
                  }}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 rounded-[10px]"
                      style={{ background: "var(--primary)" }}
                      transition={{ type: "spring", duration: 0.38, bounce: 0.12 }}
                    />
                  )}
                  <span className="relative flex items-center gap-1.5">
                    <Icon size={13} />
                    <span className="hidden sm:inline">{label}</span>
                    {badge && !active && (
                      <span
                        className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
                        style={{ background: "#FF4A4A", color: "#fff" }}
                      >
                        {badge}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-1 shrink-0">
          <div className="relative">
            <button
              onClick={toggleNotifications}
              className="relative p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="Notifications"
            >
              <Bell size={15} />
              {unreadNotificationCount > 0 && (
                <span
                  className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                  style={{ background: "#FF4A4A" }}
                />
              )}
            </button>
            <AnimatePresence>
              {notificationsOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.14 }}
                  className="absolute right-0 top-[calc(100%+10px)] w-80 rounded-xl border border-border p-3 z-[60]"
                  style={{
                    background: dark ? "rgba(11,15,25,0.98)" : "rgba(255,255,255,0.98)",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
                    backdropFilter: "blur(12px)",
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-foreground" style={{ fontSize: "12px", fontWeight: 700 }}>
                      Group notifications
                    </p>
                    {unreadNotificationCount > 0 && (
                      <Pill color="amber">{unreadNotificationCount} NEW</Pill>
                    )}
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {sortedGroupNotifications.length === 0 && (
                      <Mono className="text-muted-foreground block" style={{ fontSize: "10px" } as React.CSSProperties}>
                        No group notifications yet.
                      </Mono>
                    )}
                    {sortedGroupNotifications.map((entry) => (
                      <div key={entry.groupId} className="rounded-lg border border-border p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-foreground truncate" style={{ fontSize: "12px", fontWeight: 600 }}>
                              You were added to {entry.groupName}
                            </p>
                            <Mono className="text-muted-foreground block mt-0.5" style={{ fontSize: "10px" } as React.CSSProperties}>
                              {new Date(entry.createdAt).toLocaleString()}
                            </Mono>
                          </div>
                          {!entry.readAt && (
                            <span className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ background: "#FF4A4A" }} />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button
            onClick={() => setDark(d => !d)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Toggle theme"
          >
            <AnimatePresence mode="wait">
              <motion.span
                key={dark ? "sun" : "moon"}
                initial={{ opacity: 0, rotate: -30, scale: 0.7 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={{ opacity: 0, rotate: 30, scale: 0.7 }}
                transition={{ duration: 0.18 }}
                className="block"
              >
                {dark ? <Sun size={15} /> : <Moon size={15} />}
              </motion.span>
            </AnimatePresence>
          </button>
          <div className="relative ml-1">
            <button
              onClick={() => { void toggleProfile(); }}
              className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              title="Open profile"
            >
              <Avatar initials={profile?.initials ?? authUser.initials} size={28} />
            </button>
            <AnimatePresence>
              {profileOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.14 }}
                  className="absolute right-0 top-[calc(100%+10px)] w-72 rounded-xl border border-border p-3 z-[60]"
                  style={{
                    background: dark ? "rgba(11,15,25,0.98)" : "rgba(255,255,255,0.98)",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
                    backdropFilter: "blur(12px)",
                  }}
                >
                  <div className="flex items-center gap-2.5 mb-3">
                    <Avatar initials={profile?.initials ?? authUser.initials} size={34} />
                    <div className="min-w-0">
                      <p className="text-foreground truncate" style={{ fontSize: "13px", fontWeight: 700 }}>
                        {profile?.name ?? authUser.username}
                      </p>
                      <Mono className="text-muted-foreground truncate block" style={{ fontSize: "10px" } as React.CSSProperties}>
                        @{profile?.github ?? authUser.username}
                      </Mono>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="rounded-lg border border-border p-2">
                      <Mono className="text-muted-foreground block" style={{ fontSize: "9px" } as React.CSSProperties}>
                        EMAIL
                      </Mono>
                      <Mono className="text-foreground block mt-0.5" style={{ fontSize: "11px" } as React.CSSProperties}>
                        {authUser.email}
                      </Mono>
                    </div>
                    <div className="rounded-lg border border-border p-2">
                      <Mono className="text-muted-foreground block" style={{ fontSize: "9px" } as React.CSSProperties}>
                        WALLET
                      </Mono>
                      <Mono className="text-foreground block mt-0.5" style={{ fontSize: "11px" } as React.CSSProperties}>
                        {profile ? shortAddress(profile.wallet) : "—"}
                      </Mono>
                    </div>
                    <div className="rounded-lg border border-border p-2">
                      <Mono className="text-muted-foreground block" style={{ fontSize: "9px" } as React.CSSProperties}>
                        ACCOUNT BALANCE (SOL)
                      </Mono>
                      {profileLoading ? (
                        <span className="text-muted-foreground block mt-0.5" style={{ fontSize: "12px" }}>
                          Loading…
                        </span>
                      ) : (
                        <Mono className="text-foreground block mt-0.5" style={{ fontSize: "15px", fontWeight: 700 } as React.CSSProperties}>
                          {(profile?.solBalance ?? 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 4,
                          })} SOL
                        </Mono>
                      )}
                      {profileError && (
                        <span className="text-[#FF4A4A] block mt-1" style={{ fontSize: "10px" }}>
                          {profileError}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={logout}
                    className="mt-3 w-full rounded-lg border border-border px-2 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
                    style={{ fontSize: "11px" }}
                  >
                    Sign out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* ═══ View title strip ════════════════════════ */}
      <div
        className="px-5 py-3.5 border-b border-border shrink-0"
        style={{ background: dark ? "rgba(22,29,48,0.6)" : "rgba(255,255,255,0.8)" }}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground" style={{ fontSize: "12px" }}>
            <span>Dashboard</span>
            <ChevronRight size={12} />
            <span className="text-foreground font-medium">{activeNav.label}</span>
          </div>
          <p className="text-muted-foreground hidden sm:block" style={{ fontSize: "11px" }}>
            {activeNav.sublabel}
          </p>
        </div>
      </div>

      {/* ═══ Main content ════════════════════════════ */}
      <main className="flex-1 overflow-auto">
        <div
          className="max-w-6xl mx-auto px-5 py-5"
          style={{
            height: "100%",
            minHeight: "calc(100vh - 152px)",
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
              style={{
                height: activeView === "chat" ? "calc(100vh - 200px)" : "auto",
                minHeight: activeView === "chat" ? "520px" : undefined,
              }}
            >
              {activeView === "chat"        && (
                <ChatView
                  currentUser={authUser}
                  onUnreadCountChange={setChatUnreadCount}
                  requestedGroupId={chatSelectionRequest?.groupId}
                  requestedGroupToken={chatSelectionRequest?.token}
                />
              )}
              {activeView === "escrow"      && <EscrowView onOpenBetChat={openBetInChat} />}
              {activeView === "git"         && <GitView />}
              {activeView === "leaderboard" && <LeaderboardView />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* ═══ Status bar ══════════════════════════════ */}
      <StatusBar />
    </div>
  );
}
