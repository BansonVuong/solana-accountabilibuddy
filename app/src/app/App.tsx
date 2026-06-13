/* MARKER-MAKE-KIT-INVOKED */
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  MessageSquare, Shield, GitBranch, BarChart3,
  Zap, Sun, Moon, Bell, Settings, ChevronRight
} from "lucide-react";
import { Mono, Avatar, Pill } from "./components/ui";
import { ChatView }        from "./components/ChatView";
import { EscrowView }      from "./components/EscrowView";
import { GitView }         from "./components/GitView";
import { LeaderboardView } from "./components/LeaderboardView";
import { useRelayerHealth } from "../lib/useRelayer";

/* ── Navigation config ─────────────────────────────────── */
type ViewId = "chat" | "escrow" | "git" | "leaderboard";

const NAV: {
  id:       ViewId;
  label:    string;
  sublabel: string;
  Icon:     React.FC<{ size?: number; className?: string }>;
  badge?:   string;
}[] = [
  { id:"chat",        label:"Group Chat",   sublabel:"Lobby & Bets",     Icon:MessageSquare, badge:"2" },
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
        AccountabiliBuddy v0.9.0-beta · Vultr AI Engine
      </Mono>
    </div>
  );
}

/* ── App shell ─────────────────────────────────────────── */
export default function App() {
  const [dark,       setDark]       = useState(true);
  const [activeView, setActiveView] = useState<ViewId>("chat");

  /* Apply dark class to <html> */
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const activeNav = NAV.find(n => n.id === activeView)!;

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
            {NAV.map(({ id, label, Icon, badge }) => {
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
          <button
            className="relative p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Notifications"
          >
            <Bell size={15} />
            <span
              className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
              style={{ background: "#FF4A4A" }}
            />
          </button>
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
          <div className="ml-1">
            <Avatar initials="ME" size={28} />
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
              {activeView === "chat"        && <ChatView />}
              {activeView === "escrow"      && <EscrowView />}
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
