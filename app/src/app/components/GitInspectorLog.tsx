import { useState, useEffect } from "react";
import { CheckCircle2, XCircle, Clock, Github, RefreshCw, ChevronRight, Zap, Terminal } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

type VerdictType = "PENDING" | "APPROVED" | "REJECTED";

interface AuditResult {
  approved: boolean;
  confidence: number;
  reasoning: string;
  commit_sha: string;
  files_changed: number;
  lines_added: number;
  lines_removed: number;
  categories: string[];
}

interface DiffLine {
  type: "added" | "removed" | "context";
  lineNo: string;
  content: string;
}

const auditResults: Record<VerdictType, AuditResult> = {
  APPROVED: {
    approved: true,
    confidence: 98,
    reasoning: "Meaningful engineering work detected. Valid architectural code change with structured comments. Refactors auth middleware with security improvements and adds comprehensive test coverage.",
    commit_sha: "a3f2c91",
    files_changed: 4,
    lines_added: 127,
    lines_removed: 43,
    categories: ["refactor", "security", "tests"],
  },
  REJECTED: {
    approved: false,
    confidence: 91,
    reasoning: "Commit contains only whitespace changes and formatting adjustments. No meaningful logic or feature additions detected. Insufficient engineering effort to satisfy bet terms.",
    commit_sha: "b7d4e22",
    files_changed: 1,
    lines_added: 3,
    lines_removed: 3,
    categories: ["formatting"],
  },
  PENDING: {
    approved: false,
    confidence: 0,
    reasoning: "Analysis in progress. AI model processing commit diff against bet terms.",
    commit_sha: "c9a1f55",
    files_changed: 0,
    lines_added: 0,
    lines_removed: 0,
    categories: [],
  },
};

const diffLines: DiffLine[] = [
  { type: "context", lineNo: "14", content: "import { NextRequest, NextResponse } from 'next/server'" },
  { type: "context", lineNo: "15", content: "import { validateSession } from '@/lib/auth'" },
  { type: "removed", lineNo: "16", content: "import { db } from '@/lib/database'" },
  { type: "added", lineNo: "16", content: "import { createSecureDb } from '@/lib/secure-database'" },
  { type: "added", lineNo: "17", content: "import { rateLimit } from '@/lib/rate-limit'" },
  { type: "context", lineNo: "18", content: "" },
  { type: "removed", lineNo: "22", content: "export async function middleware(req: NextRequest) {" },
  { type: "added", lineNo: "22", content: "export async function middleware(req: NextRequest): Promise<NextResponse> {" },
  { type: "context", lineNo: "23", content: "  const session = await validateSession(req)" },
  { type: "added", lineNo: "24", content: "  const limit = await rateLimit(req.ip ?? 'unknown', { max: 100 })" },
  { type: "added", lineNo: "25", content: "  if (!limit.success) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })" },
  { type: "context", lineNo: "26", content: "  if (!session) {" },
  { type: "context", lineNo: "27", content: "    return NextResponse.redirect(new URL('/login', req.url))" },
  { type: "context", lineNo: "28", content: "  }" },
];

function RadialProgress({ verdict }: { verdict: VerdictType }) {
  const [animProgress, setAnimProgress] = useState(0);
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const targetProgress = verdict === "APPROVED" ? 0.98 : verdict === "REJECTED" ? 0.09 : 0;
  const strokeDash = animProgress * circumference;

  useEffect(() => {
    setAnimProgress(0);
    const timer = setTimeout(() => setAnimProgress(targetProgress), 200);
    return () => clearTimeout(timer);
  }, [verdict, targetProgress]);

  const color = verdict === "APPROVED" ? "#14F195" : verdict === "REJECTED" ? "#FF4A4A" : "#FFB800";

  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="currentColor"
          strokeWidth="4" className="text-border" />
        <circle cx="50" cy="50" r={radius} fill="none" stroke={color}
          strokeWidth="4" strokeLinecap="round"
          strokeDasharray={`${strokeDash} ${circumference}`}
          style={{ transition: "stroke-dasharray 1s cubic-bezier(0.4, 0, 0.2, 1)" }} />
      </svg>
      <div className="relative text-center">
        {verdict === "PENDING" ? (
          <RefreshCw size={20} className="text-[#FFB800] animate-spin mx-auto" />
        ) : verdict === "APPROVED" ? (
          <CheckCircle2 size={20} style={{ color: "#14F195" }} className="mx-auto" />
        ) : (
          <XCircle size={20} style={{ color: "#FF4A4A" }} className="mx-auto" />
        )}
        <p style={{ color, fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
          {verdict}
        </p>
      </div>
    </div>
  );
}

function DiffView() {
  return (
    <div className="rounded-xl overflow-hidden border border-border">
      <div className="px-3 py-2 bg-muted/50 border-b border-border flex items-center gap-2">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#FF4A4A]/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#FFB800]/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#14F195]/60" />
        </div>
        <span className="text-muted-foreground" style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" }}>
          middleware/auth.ts
        </span>
      </div>
      <div className="overflow-x-auto">
        {diffLines.map((line, i) => (
          <div key={i} className={`flex items-start px-0 py-0.5 ${
            line.type === "added" ? "bg-[#14F195]/5" :
            line.type === "removed" ? "bg-[#FF4A4A]/5" : ""
          }`}>
            <span className={`w-8 shrink-0 text-right pr-2 select-none border-r mr-3 ${
              line.type === "added" ? "text-[#14F195]/60 border-[#14F195]/20" :
              line.type === "removed" ? "text-[#FF4A4A]/60 border-[#FF4A4A]/20" :
              "text-muted-foreground border-border"
            }`} style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", paddingTop: "2px", paddingBottom: "2px" }}>
              {line.lineNo}
            </span>
            <span className={`mr-2 shrink-0 ${
              line.type === "added" ? "text-[#14F195]" :
              line.type === "removed" ? "text-[#FF4A4A]" :
              "text-muted-foreground"
            }`} style={{ fontSize: "12px", fontFamily: "'JetBrains Mono', monospace" }}>
              {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
            </span>
            <span className={`${
              line.type === "added" ? "text-[#14F195]/90" :
              line.type === "removed" ? "text-[#FF4A4A]/70 line-through decoration-[#FF4A4A]/40" :
              "text-muted-foreground"
            } whitespace-pre`} style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" }}>
              {line.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GitInspectorLog() {
  const [verdict, setVerdict] = useState<VerdictType>("PENDING");
  const audit = auditResults[verdict];

  return (
    <div className="space-y-4">
      {/* Top Metrics Banner */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <Github size={16} className="text-muted-foreground" />
              <div>
                <p className="text-muted-foreground uppercase tracking-widest"
                  style={{ fontSize: "9px", fontFamily: "'JetBrains Mono', monospace" }}>
                  Target Repository
                </p>
                <p className="text-foreground" style={{ fontSize: "14px", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                  jordan-dev / fullstack-bet-app
                </p>
              </div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div>
              <p className="text-muted-foreground uppercase tracking-widest"
                style={{ fontSize: "9px", fontFamily: "'JetBrains Mono', monospace" }}>
                Commit SHA
              </p>
              <p className="text-[#9945FF]" style={{ fontSize: "13px", fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}>
                {audit.commit_sha}
              </p>
            </div>
            <div className="h-8 w-px bg-border" />
            <div>
              <p className="text-muted-foreground uppercase tracking-widest"
                style={{ fontSize: "9px", fontFamily: "'JetBrains Mono', monospace" }}>
                Bet ID
              </p>
              <p className="text-foreground" style={{ fontSize: "13px", fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}>
                #DEV-0017
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-muted-foreground" style={{ fontSize: "11px" }}>Powered by</p>
              <p className="text-[#9945FF] flex items-center gap-1" style={{ fontSize: "13px", fontWeight: 600 }}>
                <Zap size={12} />
                Vultr AI Engine
              </p>
            </div>
            <RadialProgress verdict={verdict} />
          </div>
        </div>

        {verdict !== "PENDING" && (
          <div className="mt-4 pt-4 border-t border-border grid grid-cols-3 gap-4">
            {[
              { label: "Files Changed", value: audit.files_changed },
              { label: "Lines Added", value: `+${audit.lines_added}`, color: "#14F195" },
              { label: "Lines Removed", value: `-${audit.lines_removed}`, color: "#FF4A4A" },
            ].map((m) => (
              <div key={m.label} className="text-center">
                <p style={{ fontSize: "22px", fontWeight: 700, fontFamily: "'Inter', sans-serif", color: m.color || "inherit" }}>
                  {m.value}
                </p>
                <p className="text-muted-foreground" style={{ fontSize: "11px" }}>{m.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Simulate button */}
      <div className="flex items-center gap-2">
        {(["PENDING", "APPROVED", "REJECTED"] as VerdictType[]).map((v) => (
          <button
            key={v}
            onClick={() => setVerdict(v)}
            className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-all ${
              verdict === v
                ? v === "APPROVED" ? "bg-[#14F195]/10 border-[#14F195]/30 text-[#14F195]"
                  : v === "REJECTED" ? "bg-[#FF4A4A]/10 border-[#FF4A4A]/30 text-[#FF4A4A]"
                  : "bg-[#FFB800]/10 border-[#FFB800]/30 text-[#FFB800]"
                : "border-border text-muted-foreground hover:border-border/80"
            }`}
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {v}
          </button>
        ))}
        <span className="text-muted-foreground" style={{ fontSize: "11px" }}>← simulate verdict</span>
      </div>

      {/* Dual Panel */}
      <div className="grid grid-cols-2 gap-3">
        {/* AI Audit JSON Panel */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Terminal size={13} className="text-[#9945FF]" />
            <span className="text-foreground" style={{ fontSize: "12px", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
              AI Audit Response
            </span>
          </div>
          <div className="p-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={verdict}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                {verdict === "PENDING" ? (
                  <div className="flex items-center gap-2 py-8 justify-center">
                    <RefreshCw size={16} className="text-[#FFB800] animate-spin" />
                    <span className="text-[#FFB800]" style={{ fontSize: "12px", fontFamily: "'JetBrains Mono', monospace" }}>
                      Analyzing commit…
                    </span>
                  </div>
                ) : (
                  <pre className="text-[11px] leading-relaxed overflow-x-auto" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                    <span className="text-border">{"{"}</span>{"\n"}
                    <span className="text-muted-foreground">  "approved": </span>
                    <span className={audit.approved ? "text-[#14F195]" : "text-[#FF4A4A]"}>
                      {String(audit.approved)}
                    </span>,{"\n"}
                    <span className="text-muted-foreground">  "confidence": </span>
                    <span className="text-[#FFB800]">{audit.confidence}</span>,{"\n"}
                    <span className="text-muted-foreground">  "reasoning": </span>
                    <span className="text-foreground">"{audit.reasoning}"</span>,{"\n"}
                    <span className="text-muted-foreground">  "categories": </span>
                    <span className="text-[#9945FF]">
                      [{audit.categories.map(c => `"${c}"`).join(", ")}]
                    </span>{"\n"}
                    <span className="text-border">{"}"}</span>
                  </pre>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Diff Panel */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ChevronRight size={13} className="text-[#14F195]" />
              <span className="text-foreground" style={{ fontSize: "12px", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                Diff Preview
              </span>
            </div>
            <div className="flex items-center gap-2" style={{ fontSize: "10px", fontFamily: "'JetBrains Mono', monospace" }}>
              <span className="text-[#14F195]">+{audit.lines_added}</span>
              <span className="text-[#FF4A4A]">-{audit.lines_removed}</span>
            </div>
          </div>
          <div className="p-3 overflow-auto" style={{ maxHeight: "260px" }}>
            <DiffView />
          </div>
        </div>
      </div>
    </div>
  );
}
