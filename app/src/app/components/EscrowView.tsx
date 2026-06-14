import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Shield } from "lucide-react";
import { Card, Mono, Pill } from "./ui";
import { getBets, getGroups, type Bet, type Group } from "../../lib/relayer";

type EscrowViewProps = {
  onOpenBetChat?: (groupId: string) => void;
};

function isAvailableBet(bet: Bet): boolean {
  return bet.status === "PENDING" || bet.status === "ACTIVE";
}

function betTimestamp(bet: Bet): number {
  if (typeof bet.acceptedAt === "number" && Number.isFinite(bet.acceptedAt)) {
    return bet.acceptedAt;
  }
  const match = /^bet-(\d+)-/.exec(bet.id);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusPill(status: Bet["status"]): JSX.Element {
  if (status === "ACTIVE") {
    return (
      <Pill color="teal">
        <CheckCircle2 size={8} />
        ACTIVE
      </Pill>
    );
  }
  return (
    <Pill color="amber">
      <Clock size={8} />
      PENDING
    </Pill>
  );
}

export function EscrowView({ onOpenBetChat }: EscrowViewProps) {
  const [bets, setBets] = useState<Bet[]>([]);
  const [groupsById, setGroupsById] = useState<Record<string, Group>>({});
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const availableBets = useMemo(
    () => bets
      .filter(isAvailableBet)
      .sort((a, b) => betTimestamp(b) - betTimestamp(a)),
    [bets],
  );

  async function refresh(): Promise<void> {
    const [betsRes, groupsRes] = await Promise.all([getBets(), getGroups()]);
    setBets(betsRes.bets);
    setGroupsById(Object.fromEntries(groupsRes.groups.map((group) => [group.id, group])) as Record<string, Group>);
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setRefreshError(null);
    void refresh()
      .catch((err) => {
        if (!alive) return;
        setRefreshError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    const interval = setInterval(() => {
      void refresh().catch(() => {});
    }, 4000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="max-w-3xl mx-auto">
      <Card>
        <div className="px-5 py-4 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-foreground" style={{ fontSize: "16px", fontWeight: 700 }}>
                Escrow Card · Available Bets
              </p>
              <p className="text-muted-foreground mt-0.5" style={{ fontSize: "11px" }}>
                Scroll and click any bet to open its source group chat.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Pill color={availableBets.length > 0 ? "purple" : "muted"}>
                <Shield size={8} />
                {availableBets.length} AVAILABLE
              </Pill>
              <Pill color={refreshError ? "amber" : "teal"}>
                {refreshError ? <AlertTriangle size={8} /> : <CheckCircle2 size={8} />}
                {refreshError ? "SYNC ERROR" : "LIVE"}
              </Pill>
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          {loading && (
            <Mono className="text-muted-foreground" style={{ fontSize: "11px" } as React.CSSProperties}>
              Loading bets…
            </Mono>
          )}

          {!loading && availableBets.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-4">
              <Mono className="text-muted-foreground block" style={{ fontSize: "11px" } as React.CSSProperties}>
                No available bets right now.
              </Mono>
            </div>
          )}

          {availableBets.length > 0 && (
            <div className="max-h-[540px] overflow-y-auto pr-1 space-y-2">
              {availableBets.map((bet) => {
                const groupId = bet.groupId ?? "";
                const group = groupId ? groupsById[groupId] : undefined;
                const canOpenChat = Boolean(groupId);
                return (
                  <button
                    key={bet.id}
                    disabled={!canOpenChat}
                    onClick={() => {
                      if (!groupId) return;
                      onOpenBetChat?.(groupId);
                    }}
                    className="w-full text-left rounded-xl border border-border px-3 py-3 transition-colors disabled:cursor-not-allowed disabled:opacity-70 hover:bg-muted/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-foreground truncate" style={{ fontSize: "13px", fontWeight: 700 }}>
                          {bet.terms}
                        </p>
                        <p className="text-muted-foreground mt-1 truncate" style={{ fontSize: "11px" }}>
                          {bet.challenger} vs {bet.acceptor} · {bet.stake} {bet.currency}
                        </p>
                        <Mono className="text-muted-foreground block mt-1" style={{ fontSize: "10px" } as React.CSSProperties}>
                          {group ? `GROUP: ${group.name}` : "GROUP: unavailable"}
                        </Mono>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {statusPill(bet.status)}
                        {canOpenChat && (
                          <span className="inline-flex items-center gap-1 text-[#14F195]" style={{ fontSize: "11px", fontWeight: 700 }}>
                            OPEN CHAT
                            <ChevronRight size={12} />
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}