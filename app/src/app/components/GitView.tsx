import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Github, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  Terminal, FileCode2, Zap, ChevronRight, Activity
} from "lucide-react";
import { Avatar, Pill, Card, Mono } from "./ui";

/* ── Types & data ──────────────────────────────────────── */
type Verdict = "PENDING" | "APPROVED" | "REJECTED";

interface AuditReport {
  approved:      boolean;
  confidence:    number;
  reasoning:     string;
  commit_sha:    string;
  files_changed: number;
  lines_added:   number;
  lines_removed: number;
  categories:    string[];
  model:         string;
  latency_ms:    number;
}

const REPORTS: Record<Verdict, AuditReport> = {
  APPROVED: {
    approved: true, confidence: 98,
    reasoning: "Meaningful engineering work detected. Valid architectural code change with structured comments. Refactors auth middleware with rate-limiting and adds 127 lines of test coverage. Change scope satisfies bet terms.",
    commit_sha: "a3f2c91d", files_changed: 4, lines_added: 127, lines_removed: 43,
    categories: ["refactor", "security", "tests"],
    model: "vultr-llm-v2", latency_ms: 1840,
  },
  REJECTED: {
    approved: false, confidence: 91,
    reasoning: "Commit contains only whitespace normalisation and import reordering. No meaningful logic additions, feature implementations, or architectural changes detected. Insufficient engineering effort to satisfy bet terms.",
    commit_sha: "b7d4e22f", files_changed: 1, lines_added: 3, lines_removed: 3,
    categories: ["formatting"],
    model: "vultr-llm-v2", latency_ms: 1210,
  },
  PENDING: {
    approved: false, confidence: 0,
    reasoning: "",
    commit_sha: "c9a1f55b", files_changed: 0, lines_added: 0, lines_removed: 0,
    categories: [],
    model: "vultr-llm-v2", latency_ms: 0,
  },
};

interface DiffLine {
  kind:    "add" | "del" | "ctx";
  lineA:   string;
  lineB:   string;
  content: string;
}

const DIFF: DiffLine[] = [
  { kind:"ctx", lineA:"12", lineB:"12", content:"import { NextRequest, NextResponse } from 'next/server'" },
  { kind:"ctx", lineA:"13", lineB:"13", content:"import { validateSession } from '@/lib/auth'" },
  { kind:"del", lineA:"14", lineB:"",   content:"import { db } from '@/lib/database'" },
  { kind:"add", lineA:"",   lineB:"14", content:"import { createSecureDb } from '@/lib/secure-database'" },
  { kind:"add", lineA:"",   lineB:"15", content:"import { rateLimit } from '@/lib/rate-limit'" },
  { kind:"ctx", lineA:"15", lineB:"16", content:"import { logger } from '@/lib/logger'" },
  { kind:"ctx", lineA:"",   lineB:"",   content:"" },
  { kind:"del", lineA:"20", lineB:"",   content:"export async function middleware(req: NextRequest) {" },
  { kind:"add", lineA:"",   lineB:"21", content:"export async function middleware(req: NextRequest): Promise<NextResponse> {" },
  { kind:"ctx", lineA:"21", lineB:"22", content:"  const session = await validateSession(req)" },
  { kind:"add", lineA:"",   lineB:"23", content:"  const limit = await rateLimit(req.ip ?? 'anon', { max: 100, window: '1m' })" },
  { kind:"add", lineA:"",   lineB:"24", content:"  if (!limit.success) {" },
  { kind:"add", lineA:"",   lineB:"25", content:"    logger.warn('rate_limit_exceeded', { ip: req.ip })" },
  { kind:"add", lineA:"",   lineB:"26", content:"    return NextResponse.json({ error: 'Rate limited' }, { status: 429 })" },
  { kind:"add", lineA:"",   lineB:"27", content:"  }" },
  { kind:"ctx", lineA:"22", lineB:"28", content:"  if (!session) {" },
  { kind:"ctx", lineA:"23", lineB:"29", content:"    return NextResponse.redirect(new URL('/login', req.url))" },
  { kind:"ctx", lineA:"24", lineB:"30", content:"  }" },
];

/* ── Radial verdict gauge ──────────────────────────────── */
function VerdictGauge({ verdict }: { verdict: Verdict }) {
  const [progress, setProgress] = useState(0);
  const r   = 36;
  const circ = 2 * Math.PI * r;

  const target =
    verdict === "APPROVED" ? 0.98 :
    verdict === "REJECTED" ? 0.09 : 0;

  const color =
    verdict === "APPROVED" ? "#14F195" :
    verdict === "REJECTED" ? "#FF4A4A" : "#FFB800";

  useEffect(() => {
    setProgress(0);
    const t = setTimeout(() => setProgress(target), 120);
    return () => clearTimeout(t);
  }, [verdict, target]);

  return (
    <div className="relative flex items-center justify-center" style={{ width: 96, height: 96 }}>
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={r} fill="none"
          stroke="var(--border)" strokeWidth="5" />
        <circle cx="48" cy="48" r={r} fill="none"
          stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${progress * circ} ${circ}`}
          style={{ transition: "stroke-dasharray 1.1s cubic-bezier(.4,0,.2,1)", filter: verdict !== "PENDING" ? `drop-shadow(0 0 6px ${color}88)` : "none" }}
        />
      </svg>
      <div className="flex flex-col items-center gap-0.5">
        {verdict === "PENDING" ? (
          <RefreshCw size={16} className="animate-spin" style={{ color: "#FFB800" }} />
        ) : verdict === "APPROVED" ? (
          <CheckCircle2 size={18} style={{ color: "#14F195" }} />
        ) : (
          <XCircle size={18} style={{ color: "#FF4A4A" }} />
        )}
        <Mono style={{ fontSize: "9px", color, letterSpacing: "0.05em" } as React.CSSProperties}>
          {verdict}
        </Mono>
      </div>
    </div>
  );
}

/* ── JSON audit panel ──────────────────────────────────── */
function AuditPanel({ verdict, report }: { verdict: Verdict; report: AuditReport }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <Terminal size={12} className="text-primary" />
        <Mono className="text-foreground" style={{ fontSize: "11px" } as React.CSSProperties}>
          AI Audit Response
        </Mono>
        <div className="ml-auto flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: "#FF4A4A" }} />
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: "#FFB800" }} />
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: "#14F195" }} />
        </div>
      </div>

      <div className="flex-1 p-4 overflow-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={verdict}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            {verdict === "PENDING" ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1.4, ease: "linear" }}
                >
                  <RefreshCw size={20} style={{ color: "#FFB800" }} />
                </motion.div>
                <Mono className="text-muted-foreground" style={{ fontSize: "11px" } as React.CSSProperties}>
                  Analysing commit diff…
                </Mono>
                <motion.div
                  className="h-0.5 rounded-full"
                  style={{ background: "#FFB800", width: "80px" }}
                  animate={{ scaleX: [0.2, 1, 0.2] }}
                  transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
                />
              </div>
            ) : (
              <pre
                className="text-[11px] leading-6 whitespace-pre-wrap break-all"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                <span style={{ color: "var(--border)" }}>{"{\n"}</span>
                <span style={{ color: "#8A99AD" }}>{"  \"approved\":    "}</span>
                <span style={{ color: report.approved ? "#14F195" : "#FF4A4A" }}>
                  {String(report.approved)}
                </span>
                <span style={{ color: "var(--border)" }}>,</span>{"\n"}
                <span style={{ color: "#8A99AD" }}>{"  \"confidence\":  "}</span>
                <span style={{ color: "#FFB800" }}>{report.confidence}</span>
                <span style={{ color: "var(--border)" }}>,</span>{"\n"}
                <span style={{ color: "#8A99AD" }}>{"  \"reasoning\":   \""}</span>
                <span style={{ color: "var(--foreground)" }}>{report.reasoning}</span>
                <span style={{ color: "#8A99AD" }}>"</span>
                <span style={{ color: "var(--border)" }}>,</span>{"\n"}
                <span style={{ color: "#8A99AD" }}>{"  \"commit_sha\":  \""}</span>
                <span style={{ color: "#9945FF" }}>{report.commit_sha}</span>
                <span style={{ color: "#8A99AD" }}>"</span>
                <span style={{ color: "var(--border)" }}>,</span>{"\n"}
                <span style={{ color: "#8A99AD" }}>{"  \"categories\":  ["}</span>
                {report.categories.map((c, i) => (
                  <span key={c}>
                    <span style={{ color: "#14F195" }}>"{c}"</span>
                    {i < report.categories.length - 1 && <span style={{ color: "#8A99AD" }}>, </span>}
                  </span>
                ))}
                <span style={{ color: "#8A99AD" }}>]</span>
                <span style={{ color: "var(--border)" }}>,</span>{"\n"}
                <span style={{ color: "#8A99AD" }}>{"  \"model\":       \""}</span>
                <span style={{ color: "#8A99AD" }}>{report.model}</span>
                <span style={{ color: "#8A99AD" }}>"</span>
                <span style={{ color: "var(--border)" }}>,</span>{"\n"}
                <span style={{ color: "#8A99AD" }}>{"  \"latency_ms\":  "}</span>
                <span style={{ color: "#8A99AD" }}>{report.latency_ms}</span>{"\n"}
                <span style={{ color: "var(--border)" }}>{"}"}</span>
              </pre>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── Diff panel ────────────────────────────────────────── */
function DiffPanel() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <FileCode2 size={12} className="text-muted-foreground" />
          <Mono className="text-foreground" style={{ fontSize: "11px" } as React.CSSProperties}>
            middleware/auth.ts
          </Mono>
        </div>
        <div className="flex items-center gap-2">
          <Mono style={{ fontSize: "10px", color: "#14F195" } as React.CSSProperties}>+{DIFF.filter(l => l.kind === "add").length}</Mono>
          <Mono style={{ fontSize: "10px", color: "#FF4A4A" } as React.CSSProperties}>-{DIFF.filter(l => l.kind === "del").length}</Mono>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-[11px]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          <tbody>
            {DIFF.map((line, i) => {
              const isAdd = line.kind === "add";
              const isDel = line.kind === "del";
              const rowBg = isAdd
                ? "rgba(20,241,149,0.06)"
                : isDel
                  ? "rgba(255,74,74,0.06)"
                  : "transparent";

              return (
                <tr key={i} style={{ background: rowBg }}>
                  <td
                    className="select-none text-right pr-2 pl-3 border-r"
                    style={{
                      width: 28,
                      color: isDel ? "rgba(255,74,74,0.5)" : "rgba(138,153,173,0.4)",
                      borderColor: isDel ? "rgba(255,74,74,0.15)" : "var(--border)",
                      paddingTop: 2, paddingBottom: 2,
                    }}
                  >
                    {line.lineA}
                  </td>
                  <td
                    className="select-none text-right pr-2 border-r"
                    style={{
                      width: 28,
                      color: isAdd ? "rgba(20,241,149,0.5)" : "rgba(138,153,173,0.4)",
                      borderColor: isAdd ? "rgba(20,241,149,0.15)" : "var(--border)",
                      paddingTop: 2, paddingBottom: 2,
                    }}
                  >
                    {line.lineB}
                  </td>
                  <td
                    className="select-none pl-2 pr-1"
                    style={{
                      width: 16,
                      color: isAdd ? "#14F195" : isDel ? "#FF4A4A" : "transparent",
                      paddingTop: 2, paddingBottom: 2,
                    }}
                  >
                    {isAdd ? "+" : isDel ? "−" : " "}
                  </td>
                  <td
                    className="pr-4 whitespace-pre"
                    style={{
                      color: isAdd
                        ? "rgba(20,241,149,0.9)"
                        : isDel
                          ? "rgba(255,74,74,0.7)"
                          : "var(--muted-foreground)",
                      textDecoration: isDel ? "line-through" : "none",
                      paddingTop: 2, paddingBottom: 2,
                    }}
                  >
                    {line.content}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Main view ─────────────────────────────────────────── */
export function GitView() {
  const [verdict, setVerdict] = useState<Verdict>("PENDING");
  const report = REPORTS[verdict];

  return (
    <div className="space-y-4">

      {/* ── Metrics banner ───────────────────────────── */}
      <Card>
        <div className="px-5 py-4">
          <div className="flex items-center gap-6">

            {/* Repo info */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "rgba(153,69,255,0.1)", border: "1px solid rgba(153,69,255,0.2)" }}>
                <Github size={17} style={{ color: "#9945FF" }} />
              </div>
              <div className="min-w-0">
                <p className="text-muted-foreground" style={{ fontSize: "10px" }}>Target Repository</p>
                <Mono className="text-foreground truncate" style={{ fontSize: "14px", fontWeight: 600 } as React.CSSProperties}>
                  jordan-dev/fullstack-bet-app
                </Mono>
              </div>
            </div>

            {/* Divider */}
            <div className="h-10 w-px bg-border shrink-0" />

            {/* Commit SHA */}
            <div className="shrink-0">
              <p className="text-muted-foreground" style={{ fontSize: "10px" }}>Commit SHA</p>
              <Mono style={{ fontSize: "13px", color: "#9945FF" } as React.CSSProperties}>
                {verdict !== "PENDING" ? report.commit_sha : "—"}
              </Mono>
            </div>

            {/* Divider */}
            <div className="h-10 w-px bg-border shrink-0" />

            {/* Stats */}
            <div className="shrink-0">
              <p className="text-muted-foreground" style={{ fontSize: "10px" }}>Files · Added · Removed</p>
              <div className="flex items-center gap-2 mt-0.5">
                <Mono className="text-foreground" style={{ fontSize: "12px" } as React.CSSProperties}>
                  {report.files_changed}
                </Mono>
                <Mono style={{ fontSize: "12px", color: "#14F195" } as React.CSSProperties}>
                  +{report.lines_added}
                </Mono>
                <Mono style={{ fontSize: "12px", color: "#FF4A4A" } as React.CSSProperties}>
                  -{report.lines_removed}
                </Mono>
              </div>
            </div>

            {/* Divider */}
            <div className="h-10 w-px bg-border shrink-0" />

            {/* Engine badge */}
            <div className="shrink-0 flex items-center gap-2">
              <Zap size={14} style={{ color: "#9945FF" }} />
              <div>
                <p className="text-muted-foreground" style={{ fontSize: "10px" }}>Powered by</p>
                <p className="text-foreground" style={{ fontSize: "12px", fontWeight: 600 }}>Vultr AI Engine</p>
              </div>
            </div>

            {/* Radial gauge */}
            <VerdictGauge verdict={verdict} />
          </div>

          {/* Verdict tabs */}
          <div className="mt-4 pt-3 border-t border-border flex items-center gap-2">
            <span className="text-muted-foreground mr-1" style={{ fontSize: "11px" }}>
              Simulate verdict:
            </span>
            {(["PENDING", "APPROVED", "REJECTED"] as Verdict[]).map(v => {
              const active = verdict === v;
              const color  = v === "APPROVED" ? "#14F195" : v === "REJECTED" ? "#FF4A4A" : "#FFB800";
              return (
                <motion.button
                  key={v}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setVerdict(v)}
                  className="px-3 py-1.5 rounded-lg border transition-all"
                  style={{
                    fontSize: "10px",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 600,
                    background: active ? `${color}18` : "transparent",
                    borderColor: active ? `${color}55` : "var(--border)",
                    color: active ? color : "var(--muted-foreground)",
                  }}
                >
                  {v}
                </motion.button>
              );
            })}
            {verdict !== "PENDING" && (
              <Mono className="ml-auto" style={{ fontSize: "10px", color: "#8A99AD" } as React.CSSProperties}>
                latency: {report.latency_ms}ms
              </Mono>
            )}
          </div>
        </div>
      </Card>

      {/* ── Dual code panels ─────────────────────────── */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Card className="overflow-hidden" style={{ minHeight: "320px" }}>
          <AuditPanel verdict={verdict} report={report} />
        </Card>
        <Card className="overflow-hidden" style={{ minHeight: "320px" }}>
          <DiffPanel />
        </Card>
      </div>
    </div>
  );
}
