import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  X, Shield, Zap, ChevronRight, Lock, Clock,
  Users, AlertCircle, CheckCircle2
} from "lucide-react";
import { Avatar, Pill, Mono } from "./ui";
import { getScoreboard, type ScoreboardGame, type SportKind } from "../../lib/relayer";

/* ── Types ─────────────────────────────────────────────── */
export type BetType = "PERSONAL" | "DEV";

export interface NewBet {
  type:       BetType;
  challenger: string;
  acceptor:   string;
  terms:      string;
  stake:      string;
  currency:   "SOL";
  // Present for sports bets (stored internally as DEV for backwards compatibility).
  sport?:     SportKind;
  gameId?:    string;
  backsHome?: boolean;
  homeTeam?:  string;
  awayTeam?:  string;
}

const SPORT_LABELS: Record<SportKind, string> = {
  nba: "NBA", nfl: "NFL", nhl: "NHL", soccer: "Soccer",
};

interface SendBetModalProps {
  open:       boolean;
  onClose:    () => void;
  onSend:     (bet: NewBet) => void;
  groupName:  string;
  groupMembers: { name: string; initials: string }[];
}

/* ── Step indicator ────────────────────────────────────── */
function StepDot({ active, done }: { active: boolean; done: boolean }) {
  return (
    <motion.div
      animate={{
        width:      active ? 20 : 8,
        background: done   ? "#14F195"
                  : active ? "#9945FF"
                  :          "var(--border)",
      }}
      transition={{ duration: 0.25 }}
      className="h-2 rounded-full"
    />
  );
}

/* ── Main modal ────────────────────────────────────────── */
export function SendBetModal({
  open, onClose, onSend, groupName, groupMembers,
}: SendBetModalProps) {
  const [step,     setStep]     = useState(0);            // 0=type, 1=terms, 2=stake, 3=confirm
  const [betType,  setBetType]  = useState<BetType>("PERSONAL");
  const [acceptor, setAcceptor] = useState("");
  const [terms,    setTerms]    = useState("");
  const [stake,    setStake]    = useState("");
  const [sent,     setSent]     = useState(false);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const challengeTargets = useMemo(() => {
    const seen = new Set<string>();
    const deduped: { name: string; initials: string }[] = [];
    for (const member of groupMembers) {
      const name = member.name.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({ name, initials: member.initials });
    }
    return deduped;
  }, [groupMembers]);
  const hasChallengeTargets = challengeTargets.length > 0;
  const selectedAcceptor = challengeTargets.find(
    (member) => member.name.toLowerCase() === acceptor.trim().toLowerCase(),
  )?.name ?? "";
  const hasSelectedAcceptor = selectedAcceptor.length > 0;

  // ── sports bet picker state ──────────────────────────────
  const [sport,        setSport]        = useState<SportKind>("nba");
  const [games,        setGames]        = useState<ScoreboardGame[]>([]);
  const [loadingGames, setLoadingGames] = useState(false);
  const [gamesError,   setGamesError]   = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<ScoreboardGame | null>(null);
  const [backsHome,    setBacksHome]    = useState(true);

  const isSports = betType === "DEV";
  const backedTeam = selectedGame ? (backsHome ? selectedGame.homeTeam : selectedGame.awayTeam) : "";
  const sportsTerms = selectedGame
    ? `${SPORT_LABELS[sport]}: ${selectedGame.awayTeam} @ ${selectedGame.homeTeam} — I back ${backedTeam}. Settled by the final official result.`
    : "";

  /* reset when closed */
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep(0); setBetType("PERSONAL"); setAcceptor("");
        setTerms(""); setStake(""); setSent(false);
        setSport("nba"); setGames([]); setGamesError(null); setSelectedGame(null); setBacksHome(true);
      }, 300);
    }
  }, [open]);

  /* load upcoming games whenever the sports picker is active and the sport changes */
  useEffect(() => {
    if (!open || !isSports) return;
    let alive = true;
    setLoadingGames(true);
    setGamesError(null);
    setSelectedGame(null);
    getScoreboard(sport)
      .then((res) => { if (alive) setGames(res.games); })
      .catch((err) => { if (alive) setGamesError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (alive) setLoadingGames(false); });
    return () => { alive = false; };
  }, [open, isSports, sport]);

  /* focus terms textarea on step 1 (witness bets only) */
  useEffect(() => {
    if (step === 1 && !isSports && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [step, isSports]);
  useEffect(() => {
    if (!acceptor) return;
    if (!hasSelectedAcceptor) setAcceptor("");
  }, [acceptor, hasSelectedAcceptor]);

  const canStep1 = hasChallengeTargets && (
    isSports ? selectedGame !== null
    : hasSelectedAcceptor
  );
  const canStep2 = isSports ? selectedGame !== null : terms.trim().length > 8;
  const canStep3 = stake.trim().length > 0 && Number(stake) > 0;
  const summaryAcceptor = isSports ? (acceptor.trim() || "Anyone") : acceptor.trim();

  function handleSend() {
    if (!hasChallengeTargets || (!isSports && !hasSelectedAcceptor) || (isSports && !selectedGame)) return;
    setSent(true);
    onSend({
      type:     betType,
      challenger: "Me",
      acceptor: isSports ? (selectedAcceptor || "anyone") : selectedAcceptor,
      terms:    isSports ? sportsTerms : terms.trim(),
      stake:    stake,
      currency: "SOL",
      ...(isSports && selectedGame ? {
        sport,
        gameId:   selectedGame.gameId,
        backsHome,
        homeTeam: selectedGame.homeTeam,
        awayTeam: selectedGame.awayTeam,
      } : {}),
    });
    setTimeout(onClose, 1800);
  }

  const STEPS = ["Type", "Terms", "Stake", "Confirm"];

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          />

          {/* Panel */}
          <div className="fixed inset-0 z-[51] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, y: 32, scale: 0.96 }}
              animate={{ opacity: 1, y: 0,  scale: 1    }}
              exit={{   opacity: 0, y: 16,  scale: 0.97 }}
              transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="w-full rounded-2xl border border-border overflow-hidden pointer-events-auto"
              style={{
                width:     "min(460px, 100%)",
                background: "var(--card)",
                boxShadow: "0 24px 64px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)",
                maxHeight: "calc(100vh - 32px)",
                display:   "flex",
                flexDirection: "column",
              }}
            >

            {/* ── Header ──────────────────────────────── */}
            <div className="px-5 pt-5 pb-4 border-b border-border shrink-0">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-6 h-6 rounded-lg flex items-center justify-center"
                      style={{ background: "linear-gradient(135deg, #9945FF, #14F195)" }}
                    >
                      <Zap size={11} className="text-white" />
                    </div>
                    <p className="text-foreground" style={{ fontSize: "15px", fontWeight: 700 }}>
                      Send a Bet
                    </p>
                  </div>
                  <p className="text-muted-foreground" style={{ fontSize: "11px" }}>
                    Posting to <span className="text-foreground font-medium">{groupName}</span>
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Step dots */}
              <div className="flex items-center gap-1.5 mt-4">
                {STEPS.map((label, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <StepDot active={step === i} done={step > i} />
                    {i < STEPS.length - 1 && (
                      <div className="h-px w-4" style={{ background: step > i ? "#14F195" : "var(--border)" }} />
                    )}
                  </div>
                ))}
                <Mono className="text-muted-foreground ml-2" style={{ fontSize: "10px" } as React.CSSProperties}>
                  {STEPS[step].toUpperCase()}
                </Mono>
              </div>
            </div>

            {/* ── Step body ───────────────────────────── */}
            <div className="flex-1 overflow-y-auto">
              <AnimatePresence mode="wait">
                {/* STEP 0 — Bet type */}
                {step === 0 && (
                  <motion.div
                    key="step0"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0  }}
                    exit={{   opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                    className="px-5 py-5 space-y-4"
                  >
                    <p className="text-muted-foreground" style={{ fontSize: "12px" }}>
                      What kind of bet?
                    </p>
                    {!hasChallengeTargets && (
                      <div
                        className="flex items-start gap-2.5 p-3 rounded-xl"
                        style={{ background: "rgba(255,74,74,0.08)", border: "1px solid rgba(255,74,74,0.25)" }}
                      >
                        <AlertCircle size={13} style={{ color: "#FF7E7E", marginTop: 1, flexShrink: 0 }} />
                        <p className="text-muted-foreground leading-snug" style={{ fontSize: "11px" }}>
                          This group has no challenge targets yet. Add at least one member before posting a bet.
                        </p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      {(["PERSONAL", "DEV"] as BetType[]).map(t => (
                        <motion.button
                          key={t}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => setBetType(t)}
                          className="p-4 rounded-2xl border flex flex-col items-start gap-2 text-left transition-all duration-200"
                          style={{
                            background:  betType === t
                              ? t === "DEV" ? "rgba(20,241,149,0.08)" : "rgba(153,69,255,0.08)"
                              : "var(--muted)",
                            borderColor: betType === t
                              ? t === "DEV" ? "rgba(20,241,149,0.35)" : "rgba(153,69,255,0.35)"
                              : "var(--border)",
                            boxShadow: betType === t
                              ? t === "DEV" ? "0 0 0 1px rgba(20,241,149,0.12)" : "0 0 0 1px rgba(153,69,255,0.12)"
                              : "none",
                          }}
                        >
                          <div
                            className="w-8 h-8 rounded-xl flex items-center justify-center"
                            style={{
                              background: t === "DEV" ? "rgba(20,241,149,0.15)" : "rgba(153,69,255,0.15)",
                            }}
                          >
                            {t === "DEV"
                              ? <Zap size={14} style={{ color: "#14F195" }} />
                              : <Shield size={14} style={{ color: "#9945FF" }} />
                            }
                          </div>
                          <p className="text-foreground" style={{ fontSize: "13px", fontWeight: 700 }}>
                            {t === "DEV" ? "Sports Bet" : "Personal Bet"}
                          </p>
                          <p className="text-muted-foreground leading-snug" style={{ fontSize: "10px" }}>
                            {t === "DEV"
                              ? "Settled automatically from the official game result"
                              : "Peer accountability — group votes on outcome"}
                          </p>
                          {betType === t && (
                            <CheckCircle2
                              size={13}
                              className="self-end mt-1"
                              style={{ color: t === "DEV" ? "#14F195" : "#9945FF" }}
                            />
                          )}
                        </motion.button>
                      ))}
                    </div>

                    {/* Sports picker */}
                    {isSports && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-3"
                      >
                        <Mono className="text-muted-foreground uppercase" style={{ fontSize: "9px", letterSpacing: "0.1em" } as React.CSSProperties}>
                          Select sport and matchup
                        </Mono>
                        <div className="space-y-3">
                          {/* Sport tabs */}
                          <div className="flex gap-1.5">
                            {(["nba", "nfl", "nhl", "soccer"] as SportKind[]).map(s => (
                              <button
                                key={s}
                                onClick={() => setSport(s)}
                                className="flex-1 py-1.5 rounded-lg border transition-all duration-150"
                                style={{
                                  background:  sport === s ? "rgba(153,69,255,0.12)" : "var(--muted)",
                                  borderColor: sport === s ? "rgba(153,69,255,0.4)" : "var(--border)",
                                  color:       sport === s ? "#9945FF" : "var(--muted-foreground)",
                                  fontSize: "11px", fontWeight: sport === s ? 700 : 500,
                                }}
                              >
                                {SPORT_LABELS[s]}
                              </button>
                            ))}
                          </div>

                          {/* Games list */}
                          <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                            {loadingGames && (
                              <p className="text-muted-foreground text-center py-3" style={{ fontSize: "11px" }}>Loading games…</p>
                            )}
                            {gamesError && (
                              <p className="text-center py-3" style={{ fontSize: "11px", color: "#FF7E7E" }}>{gamesError}</p>
                            )}
                            {!loadingGames && !gamesError && games.length === 0 && (
                              <p className="text-muted-foreground text-center py-3" style={{ fontSize: "11px" }}>
                                No {SPORT_LABELS[sport]} games on the board right now.
                              </p>
                            )}
                            {games.map(g => {
                              const picked = selectedGame?.gameId === g.gameId;
                              const kickoffLabel = g.startTime
                                ? new Date(g.startTime).toLocaleString([], {
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })
                                : null;
                              return (
                                <button
                                  key={g.gameId}
                                  disabled={g.isFinal}
                                  onClick={() => { setSelectedGame(g); setBacksHome(true); }}
                                  className="w-full px-3 py-2 rounded-lg border text-left transition-all duration-150 disabled:opacity-40"
                                  style={{
                                    background:  picked ? "rgba(153,69,255,0.1)" : "var(--muted)",
                                    borderColor: picked ? "rgba(153,69,255,0.45)" : "var(--border)",
                                  }}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-foreground truncate" style={{ fontSize: "12px", fontWeight: 600 }}>
                                      {g.awayTeam} @ {g.homeTeam}
                                    </span>
                                    <Mono className="text-muted-foreground shrink-0" style={{ fontSize: "9px" } as React.CSSProperties}>
                                        {kickoffLabel ?? (g.isFinal ? "FINAL" : (g.status || "—"))}
                                    </Mono>
                                  </div>
                                </button>
                              );
                            })}
                          </div>

                          {/* Side picker */}
                          {selectedGame && (
                            <div className="space-y-1.5">
                              <Mono className="text-muted-foreground uppercase" style={{ fontSize: "9px", letterSpacing: "0.1em" } as React.CSSProperties}>
                                Which side are you backing?
                              </Mono>
                              <div className="grid grid-cols-2 gap-2">
                                {([
                                  { home: false, team: selectedGame.awayTeam },
                                  { home: true,  team: selectedGame.homeTeam },
                                ]).map(opt => (
                                  <button
                                    key={opt.team}
                                    onClick={() => setBacksHome(opt.home)}
                                    className="px-3 py-2 rounded-lg border text-left transition-all duration-150"
                                    style={{
                                      background:  backsHome === opt.home ? "rgba(20,241,149,0.1)" : "var(--muted)",
                                      borderColor: backsHome === opt.home ? "rgba(20,241,149,0.45)" : "var(--border)",
                                    }}
                                  >
                                    <Mono className="text-muted-foreground block" style={{ fontSize: "8px" } as React.CSSProperties}>
                                      {opt.home ? "HOME" : "AWAY"}
                                    </Mono>
                                    <span className="text-foreground truncate block" style={{ fontSize: "12px", fontWeight: 700 }}>{opt.team}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}

                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-2"
                    >
                      <Mono className="text-muted-foreground uppercase" style={{ fontSize: "9px", letterSpacing: "0.1em" } as React.CSSProperties}>
                        Challenge who?
                      </Mono>
                      <div className="flex flex-wrap gap-2">
                        {challengeTargets.map((member) => {
                          const isSelected = selectedAcceptor.toLowerCase() === member.name.toLowerCase();
                          return (
                            <motion.button
                              key={member.name}
                              whileHover={{ scale: 1.04 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => setAcceptor(member.name)}
                              className="flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all duration-150"
                              style={{
                                background:  isSelected ? "rgba(153,69,255,0.1)" : "var(--muted)",
                                borderColor: isSelected ? "rgba(153,69,255,0.4)" : "var(--border)",
                                color:       isSelected ? "#9945FF" : "var(--muted-foreground)",
                                fontSize:    "12px",
                                fontWeight:  isSelected ? 700 : 400,
                              }}
                            >
                              <Avatar initials={member.initials} size={20} />
                              {member.name}
                            </motion.button>
                          );
                        })}
                        {!challengeTargets.length && (
                          <span className="text-muted-foreground" style={{ fontSize: "11px" }}>
                            No members available to challenge in this group yet.
                          </span>
                        )}
                      </div>
                    </motion.div>
                  </motion.div>
                )}

                {/* STEP 1 — Terms */}
                {step === 1 && (
                  <motion.div
                    key="step1"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0  }}
                    exit={{   opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                    className="px-5 py-5 space-y-4"
                  >
                    {isSports ? (
                      <div className="space-y-3">
                        <p className="text-muted-foreground" style={{ fontSize: "12px" }}>
                          This bet settles automatically from the final game result — no terms to write.
                        </p>
                        <div
                          className="rounded-xl border p-4 space-y-3"
                          style={{ background: "rgba(153,69,255,0.05)", borderColor: "rgba(153,69,255,0.25)" }}
                        >
                          <Mono className="text-muted-foreground uppercase" style={{ fontSize: "9px", letterSpacing: "0.1em" } as React.CSSProperties}>
                            {SPORT_LABELS[sport]} · Game #{selectedGame?.gameId}
                          </Mono>
                          <p className="text-foreground" style={{ fontSize: "15px", fontWeight: 700 }}>
                            {selectedGame?.awayTeam} @ {selectedGame?.homeTeam}
                          </p>
                          <div className="flex items-center gap-2">
                            <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>YOU BACK</Mono>
                            <span className="px-2 py-0.5 rounded-md" style={{ background: "rgba(20,241,149,0.12)", color: "#14F195", fontSize: "12px", fontWeight: 700 }}>
                              {backedTeam}
                            </span>
                          </div>
                          <p className="text-muted-foreground leading-snug" style={{ fontSize: "11px" }}>
                            The opponent automatically backs {backsHome ? selectedGame?.awayTeam : selectedGame?.homeTeam}. The oracle pays out the winner once the game is final.
                          </p>
                        </div>
                      </div>
                    ) : (
                    <div>
                      <p className="text-muted-foreground mb-3" style={{ fontSize: "12px" }}>
                        Describe the bet in clear, specific terms. This becomes the on-chain record.
                      </p>
                      <div
                        className="rounded-xl border transition-all duration-200"
                        style={{
                          background:  "var(--muted)",
                          borderColor: terms.length > 0 ? "rgba(153,69,255,0.3)" : "var(--border)",
                          boxShadow:   terms.length > 0 ? "0 0 0 1px rgba(153,69,255,0.1)" : "none",
                        }}
                      >
                        <textarea
                          ref={inputRef}
                          value={terms}
                          onChange={e => setTerms(e.target.value)}
                          placeholder="e.g. I bet Kevin cannot complete a 5k run before 8 AM tomorrow"
                          rows={4}
                          className="w-full bg-transparent text-foreground placeholder:text-muted-foreground outline-none resize-none p-4 leading-relaxed"
                          style={{ fontSize: "13px" }}
                        />
                        <div className="px-4 pb-2 flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Shield size={10} className="text-muted-foreground" />
                            <Mono className="text-muted-foreground" style={{ fontSize: "9px" } as React.CSSProperties}>
                              WITNESS VERIFIED
                            </Mono>
                          </div>
                          <Mono
                            className="text-muted-foreground"
                            style={{
                              fontSize: "9px",
                              color: terms.length > 200 ? "#FF4A4A" : undefined,
                            } as React.CSSProperties}
                          >
                            {terms.length}/200
                          </Mono>
                        </div>
                      </div>
                    </div>
                    )}

                  </motion.div>
                )}

                {/* STEP 2 — Stake */}
                {step === 2 && (
                  <motion.div
                    key="step2"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0  }}
                    exit={{   opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                    className="px-5 py-5 space-y-4"
                  >
                    <p className="text-muted-foreground" style={{ fontSize: "12px" }}>
                      How much SOL goes into on-chain escrow if the bet is accepted?
                    </p>

                    <div>
                      <Mono className="text-muted-foreground uppercase mb-2 block" style={{ fontSize: "9px", letterSpacing: "0.1em" } as React.CSSProperties}>
                        Amount each side stakes
                      </Mono>
                      <div
                        className="flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-200"
                        style={{
                          background:  "var(--muted)",
                          borderColor: stake.length > 0 && Number(stake) > 0 ? "rgba(153,69,255,0.35)" : "var(--border)",
                          boxShadow:   stake.length > 0 && Number(stake) > 0 ? "0 0 0 1px rgba(153,69,255,0.1)" : "none",
                        }}
                      >
                        <span style={{ color: "#9945FF", fontSize: "18px" }}>◎</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={stake}
                          onChange={e => setStake(e.target.value)}
                          placeholder="0.25"
                          className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
                          style={{ fontSize: "22px", fontWeight: 800, fontFamily: "'Inter', sans-serif" }}
                        />
                        <Mono className="text-muted-foreground shrink-0" style={{ fontSize: "12px" } as React.CSSProperties}>
                          SOL
                        </Mono>
                      </div>
                    </div>

                    {stake && Number(stake) > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                        style={{
                          background: "rgba(153,69,255,0.06)",
                          border: "1px solid rgba(153,69,255,0.15)",
                        }}
                      >
                        <Lock size={11} style={{ color: "#9945FF", flexShrink: 0 }} />
                        <p className="text-muted-foreground" style={{ fontSize: "11px" }}>
                          <span className="text-foreground font-semibold">{stake} SOL</span> will be locked on both sides when the acceptor confirms.
                        </p>
                      </motion.div>
                    )}
                  </motion.div>
                )}

                {/* STEP 3 — Confirm */}
                {step === 3 && (
                  <motion.div
                    key="step3"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0  }}
                    exit={{   opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                    className="px-5 py-5 space-y-4"
                  >
                    {sent ? (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex flex-col items-center justify-center py-8 gap-4"
                      >
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: "spring", delay: 0.1, bounce: 0.5 }}
                          className="w-14 h-14 rounded-full flex items-center justify-center"
                          style={{ background: "rgba(20,241,149,0.12)", border: "2px solid rgba(20,241,149,0.4)" }}
                        >
                          <CheckCircle2 size={28} style={{ color: "#14F195" }} />
                        </motion.div>
                        <div className="text-center">
                          <p className="text-foreground" style={{ fontSize: "15px", fontWeight: 700 }}>Bet sent!</p>
                          <p className="text-muted-foreground" style={{ fontSize: "12px" }}>
                            Posted to {groupName} — waiting for acceptance
                          </p>
                        </div>
                      </motion.div>
                    ) : (
                      <>
                        <p className="text-muted-foreground" style={{ fontSize: "12px" }}>
                          Review your bet before it goes live in the chat.
                        </p>

                        {/* Summary card */}
                        <div
                          className="rounded-2xl p-4 border space-y-3"
                          style={{
                            background:  betType === "DEV" ? "rgba(20,241,149,0.04)" : "rgba(153,69,255,0.04)",
                            borderColor: betType === "DEV" ? "rgba(20,241,149,0.2)" : "rgba(153,69,255,0.2)",
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <Pill color={betType === "DEV" ? "teal" : "purple"}>
                              {betType === "DEV" ? <Zap size={8} /> : <Shield size={8} />}
                              {betType === "DEV" ? "SPORTS" : "PERSONAL"}
                            </Pill>
                            <Pill color="amber">
                              <Clock size={8} />
                              PENDING
                            </Pill>
                          </div>

                          <p className="text-foreground leading-snug" style={{ fontSize: "15px", fontWeight: 700 }}>
                            "{isSports ? sportsTerms : terms}"
                          </p>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Mono className="text-muted-foreground block mb-1" style={{ fontSize: "9px", letterSpacing: "0.08em" } as React.CSSProperties}>
                                CHALLENGER
                              </Mono>
                              <div className="flex items-center gap-1.5">
                                <Avatar initials="ME" size={20} />
                                <span className="text-foreground" style={{ fontSize: "12px", fontWeight: 600 }}>You</span>
                              </div>
                            </div>
                            {(isSports || summaryAcceptor) && (
                              <div>
                                <Mono className="text-muted-foreground block mb-1" style={{ fontSize: "9px", letterSpacing: "0.08em" } as React.CSSProperties}>
                                  ACCEPTOR
                                </Mono>
                                <div className="flex items-center gap-1.5">
                                  <Avatar
                                    initials={summaryAcceptor.slice(0, 2).toUpperCase()}
                                    size={20}
                                  />
                                  <span className="text-foreground" style={{ fontSize: "12px", fontWeight: 600 }}>{summaryAcceptor}</span>
                                </div>
                              </div>
                            )}
                          </div>

                          <div
                            className="flex items-center gap-2 pt-2 border-t"
                            style={{ borderColor: betType === "DEV" ? "rgba(20,241,149,0.15)" : "rgba(153,69,255,0.15)" }}
                          >
                            <Lock size={11} style={{ color: betType === "DEV" ? "#14F195" : "#9945FF", flexShrink: 0 }} />
                            <span
                              style={{
                                fontSize: "15px",
                                fontWeight: 800,
                                color: betType === "DEV" ? "#14F195" : "#9945FF",
                                fontFamily: "'JetBrains Mono', monospace",
                              }}
                            >
                              {stake} SOL
                            </span>
                            <span className="text-muted-foreground" style={{ fontSize: "11px" }}>
                              locked per side on acceptance
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                          style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                        >
                          <Users size={11} className="text-muted-foreground shrink-0" />
                          <p className="text-muted-foreground" style={{ fontSize: "11px" }}>
                            Group members will be notified and can follow the result.
                          </p>
                        </div>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── Footer actions ───────────────────────── */}
            {!sent && (
              <div className="px-5 py-4 border-t border-border shrink-0 flex items-center gap-2">
                {step > 0 && (
                  <button
                    onClick={() => setStep(s => s - 1)}
                    className="px-4 py-2 rounded-xl border border-border text-muted-foreground hover:text-foreground transition-colors"
                    style={{ fontSize: "12px", fontWeight: 600 }}
                  >
                    Back
                  </button>
                )}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    if (step < 3) setStep(s => s + 1);
                    else handleSend();
                  }}
                  disabled={
                    (step === 0 && !canStep1) ||
                    (step === 1 && !canStep2) ||
                    (step === 2 && !canStep3)
                  }
                  className="ml-auto flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-semibold transition-all duration-200"
                  style={{
                    fontSize: "12px",
                    background: (() => {
                      const ok = (step === 0 && canStep1) || (step === 1 && canStep2) || (step === 2 && canStep3) || step === 3;
                      return ok
                        ? step === 3
                          ? "linear-gradient(135deg, #9945FF, #14F195)"
                          : "var(--primary)"
                        : "var(--muted)";
                    })(),
                    color: ((step === 0 && canStep1) || (step === 1 && canStep2) || (step === 2 && canStep3) || step === 3)
                      ? "#fff"
                      : "var(--muted-foreground)",
                    boxShadow: step === 3 ? "0 0 20px rgba(153,69,255,0.3)" : "none",
                  }}
                >
                  {step === 3 ? (
                    <>Post to Chat <Zap size={12} /></>
                  ) : (
                    <>Next <ChevronRight size={12} /></>
                  )}
                </motion.button>
              </div>
            )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
