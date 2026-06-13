import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X, Shield, Zap, ChevronRight, Lock, Clock,
  Users, AlertCircle, CheckCircle2
} from "lucide-react";
import { Avatar, Pill, Mono } from "./ui";

/* ── Types ─────────────────────────────────────────────── */
export type BetType = "PERSONAL" | "DEV";
export type BetCurrency = "POINTS" | "SOL";

export interface NewBet {
  type:       BetType;
  challenger: string;
  acceptor:   string;
  terms:      string;
  stake:      string;
  currency:   BetCurrency;
}

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

/* ── Currency button ───────────────────────────────────── */
function CurrencyBtn({
  value, selected, onClick,
}: { value: BetCurrency; selected: boolean; onClick: () => void }) {
  const isSOL = value === "SOL";
  const accent = isSOL ? "#9945FF" : "#FFB800";

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="flex-1 py-3 px-4 rounded-xl border transition-all duration-200 flex items-center gap-3"
      style={{
        background:  selected ? (isSOL ? "rgba(153,69,255,0.1)" : "rgba(255,184,0,0.1)") : "var(--muted)",
        borderColor: selected ? accent : "var(--border)",
        boxShadow:   selected ? `0 0 0 1px ${accent}33` : "none",
      }}
    >
      <span style={{ fontSize: 20 }}>{isSOL ? "◎" : "🏆"}</span>
      <div className="text-left">
        <p className="text-foreground" style={{ fontSize: "13px", fontWeight: 700 }}>{value}</p>
        <p className="text-muted-foreground" style={{ fontSize: "10px" }}>
          {isSOL ? "On-chain · Solana" : "Platform points"}
        </p>
      </div>
      {selected && (
        <CheckCircle2 size={14} className="ml-auto" style={{ color: accent }} />
      )}
    </motion.button>
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
  const [currency, setCurrency] = useState<BetCurrency>("POINTS");
  const [sent,     setSent]     = useState(false);
  const inputRef   = useRef<HTMLTextAreaElement>(null);

  /* reset when closed */
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep(0); setBetType("PERSONAL"); setAcceptor("");
        setTerms(""); setStake(""); setCurrency("POINTS"); setSent(false);
      }, 300);
    }
  }, [open]);

  /* focus terms textarea on step 1 */
  useEffect(() => {
    if (step === 1 && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [step]);

  const canStep1 = betType && (betType === "DEV" ? true : acceptor.trim().length > 0);
  const canStep2 = terms.trim().length > 8;
  const canStep3 = stake.trim().length > 0 && Number(stake) > 0;

  function handleSend() {
    setSent(true);
    onSend({
      type:     betType,
      challenger: "Me",
      acceptor: betType === "DEV" ? (acceptor || "anyone") : acceptor,
      terms:    terms.trim(),
      stake:    stake,
      currency,
    });
    setTimeout(onClose, 1800);
  }

  const STEPS = ["Type", "Terms", "Stake", "Confirm"];

  return (
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
          <motion.div
            initial={{ opacity: 0, y: 32, scale: 0.96 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{   opacity: 0, y: 16,  scale: 0.97 }}
            transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="fixed z-50 rounded-2xl border border-border overflow-hidden"
            style={{
              width:     "min(460px, calc(100vw - 32px))",
              top:       "50%",
              left:      "50%",
              transform: "translate(-50%, -50%)",
              background: "var(--card)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)",
              maxHeight: "calc(100vh - 48px)",
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
                            {t === "DEV" ? "Dev Bet" : "Personal Bet"}
                          </p>
                          <p className="text-muted-foreground leading-snug" style={{ fontSize: "10px" }}>
                            {t === "DEV"
                              ? "Verified by AI Git inspector — no judges needed"
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

                    {/* Acceptor picker — PERSONAL only */}
                    {betType === "PERSONAL" && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-2"
                      >
                        <Mono className="text-muted-foreground uppercase" style={{ fontSize: "9px", letterSpacing: "0.1em" } as React.CSSProperties}>
                          Challenge who?
                        </Mono>
                        <div className="flex flex-wrap gap-2">
                          {groupMembers.map(m => (
                            <motion.button
                              key={m.name}
                              whileHover={{ scale: 1.04 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => setAcceptor(m.name)}
                              className="flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all duration-150"
                              style={{
                                background:  acceptor === m.name ? "rgba(153,69,255,0.1)" : "var(--muted)",
                                borderColor: acceptor === m.name ? "rgba(153,69,255,0.4)" : "var(--border)",
                                color:       acceptor === m.name ? "#9945FF" : "var(--muted-foreground)",
                                fontSize:    "12px",
                                fontWeight:  acceptor === m.name ? 700 : 400,
                              }}
                            >
                              <Avatar initials={m.initials} size={20} />
                              {m.name}
                            </motion.button>
                          ))}
                        </div>
                      </motion.div>
                    )}
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
                          placeholder={
                            betType === "DEV"
                              ? "e.g. I bet Sarah cannot merge a working OAuth feature before end of Friday"
                              : "e.g. I bet Kevin cannot complete a 5k run before 8 AM tomorrow"
                          }
                          rows={4}
                          className="w-full bg-transparent text-foreground placeholder:text-muted-foreground outline-none resize-none p-4 leading-relaxed"
                          style={{ fontSize: "13px" }}
                        />
                        <div className="px-4 pb-2 flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            {betType === "PERSONAL"
                              ? <Shield size={10} className="text-muted-foreground" />
                              : <Zap size={10} className="text-muted-foreground" />
                            }
                            <Mono className="text-muted-foreground" style={{ fontSize: "9px" } as React.CSSProperties}>
                              {betType === "PERSONAL" ? "WITNESS VERIFIED" : "AI GIT VERIFIED"}
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

                    {betType === "DEV" && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-start gap-2.5 p-3 rounded-xl"
                        style={{
                          background:  "rgba(20,241,149,0.06)",
                          border:      "1px solid rgba(20,241,149,0.2)",
                        }}
                      >
                        <AlertCircle size={13} style={{ color: "#14F195", marginTop: 1, flexShrink: 0 }} />
                        <p className="text-muted-foreground leading-snug" style={{ fontSize: "11px" }}>
                          The AI inspector will scan the target repo's git log for qualifying commits. Make sure the terms include a repo URL or the challenger's GitHub handle.
                        </p>
                      </motion.div>
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
                      What goes into escrow if the bet is accepted?
                    </p>

                    <div className="flex gap-2">
                      <CurrencyBtn value="POINTS" selected={currency === "POINTS"} onClick={() => setCurrency("POINTS")} />
                      <CurrencyBtn value="SOL"    selected={currency === "SOL"}    onClick={() => setCurrency("SOL")} />
                    </div>

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
                        <span style={{ color: currency === "SOL" ? "#9945FF" : "#FFB800", fontSize: "18px" }}>
                          {currency === "SOL" ? "◎" : "🏆"}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step={currency === "SOL" ? "0.01" : "100"}
                          value={stake}
                          onChange={e => setStake(e.target.value)}
                          placeholder={currency === "SOL" ? "0.25" : "1000"}
                          className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
                          style={{ fontSize: "22px", fontWeight: 800, fontFamily: "'Inter', sans-serif" }}
                        />
                        <Mono className="text-muted-foreground shrink-0" style={{ fontSize: "12px" } as React.CSSProperties}>
                          {currency}
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
                          <span className="text-foreground font-semibold">{stake} {currency}</span> will be locked on both sides when the acceptor confirms.
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
                              {betType}
                            </Pill>
                            <Pill color="amber">
                              <Clock size={8} />
                              PENDING
                            </Pill>
                          </div>

                          <p className="text-foreground leading-snug" style={{ fontSize: "15px", fontWeight: 700 }}>
                            "{terms}"
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
                            {acceptor && (
                              <div>
                                <Mono className="text-muted-foreground block mb-1" style={{ fontSize: "9px", letterSpacing: "0.08em" } as React.CSSProperties}>
                                  ACCEPTOR
                                </Mono>
                                <div className="flex items-center gap-1.5">
                                  <Avatar
                                    initials={acceptor.slice(0, 2).toUpperCase()}
                                    size={20}
                                  />
                                  <span className="text-foreground" style={{ fontSize: "12px", fontWeight: 600 }}>{acceptor}</span>
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
                              {stake} {currency}
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
                            Group members will be notified and can witness the outcome.
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
        </>
      )}
    </AnimatePresence>
  );
}