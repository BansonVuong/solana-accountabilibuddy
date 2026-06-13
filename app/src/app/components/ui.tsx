/** Shared primitive atoms used across all views */
import { type ReactNode } from "react";

/* ── Mono label ────────────────────────────────────────── */
export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={className}
      style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}
    >
      {children}
    </span>
  );
}

/* ── Status pill ───────────────────────────────────────── */
type PillColor = "purple" | "teal" | "amber" | "crimson" | "muted";

const pillMap: Record<PillColor, { bg: string; text: string; border: string }> = {
  purple: { bg: "rgba(153,69,255,0.1)",  text: "#9945FF", border: "rgba(153,69,255,0.25)" },
  teal:   { bg: "rgba(20,241,149,0.1)",  text: "#14F195", border: "rgba(20,241,149,0.25)" },
  amber:  { bg: "rgba(255,184,0,0.1)",   text: "#FFB800", border: "rgba(255,184,0,0.25)"  },
  crimson:{ bg: "rgba(255,74,74,0.1)",   text: "#FF4A4A", border: "rgba(255,74,74,0.25)"  },
  muted:  { bg: "rgba(138,153,173,0.1)", text: "#8A99AD", border: "rgba(138,153,173,0.2)" },
};

export function Pill({
  color = "muted",
  children,
  className = "",
}: {
  color?: PillColor;
  children: ReactNode;
  className?: string;
}) {
  const c = pillMap[color];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md ${className}`}
      style={{
        background: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
        fontSize: "10px",
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/* ── Avatar bubble ─────────────────────────────────────── */
const avatarPalette = [
  { bg: "rgba(153,69,255,0.18)", text: "#9945FF" },
  { bg: "rgba(20,241,149,0.15)", text: "#14F195" },
  { bg: "rgba(255,184,0,0.15)",  text: "#FFB800" },
  { bg: "rgba(255,74,74,0.15)",  text: "#FF4A4A" },
  { bg: "rgba(59,130,246,0.15)", text: "#60A5FA" },
  { bg: "rgba(236,72,153,0.15)", text: "#F472B6" },
  { bg: "rgba(16,185,129,0.15)", text: "#34D399" },
];

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function Avatar({
  initials,
  size = 36,
  forceColor,
}: {
  initials: string;
  size?: number;
  forceColor?: PillColor;
}) {
  const palette = forceColor
    ? pillMap[forceColor]
      ? { bg: pillMap[forceColor].bg, text: pillMap[forceColor].text }
      : avatarPalette[0]
    : avatarPalette[hashStr(initials) % avatarPalette.length];

  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 select-none"
      style={{
        width: size,
        height: size,
        background: palette.bg,
        color: palette.text,
        fontSize: size * 0.36,
        fontWeight: 700,
        fontFamily: "'Inter', sans-serif",
        border: `1.5px solid ${palette.text}22`,
      }}
    >
      {initials}
    </div>
  );
}

/* ── Card shell ────────────────────────────────────────── */
export function Card({
  children,
  className = "",
  glass = false,
}: {
  children: ReactNode;
  className?: string;
  glass?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-border overflow-hidden ${className}`}
      style={glass ? { backdropFilter: "blur(12px)" } : {}}
    >
      {children}
    </div>
  );
}

/* ── Hairline divider ──────────────────────────────────── */
export function Divider({ className = "" }: { className?: string }) {
  return <div className={`h-px bg-border ${className}`} />;
}

/* ── Section label ─────────────────────────────────────── */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Mono className="text-muted-foreground block" style={{ fontSize: "9px", letterSpacing: "0.12em" } as React.CSSProperties}>
      {children}
    </Mono>
  );
}
