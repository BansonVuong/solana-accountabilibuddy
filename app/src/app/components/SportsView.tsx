import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { AlertCircle, CheckCircle2, ChevronRight, RefreshCw, Trophy } from "lucide-react";
import {
  createBet,
  getGroups,
  getScoreboard,
  type AuthUser,
  type Group,
  type ScoreboardGame,
  type SportKind,
} from "../../lib/relayer";
import { Mono, Pill } from "./ui";

const SPORTS: SportKind[] = ["nba", "nfl", "nhl", "soccer"];
const SPORT_LABELS: Record<SportKind, string> = {
  nba: "NBA",
  nfl: "NFL",
  nhl: "NHL",
  soccer: "Soccer",
};

type SportsViewProps = {
  currentUser: AuthUser;
  onOpenBetChat?: (groupId: string, betId: string) => void;
};

export function SportsView({ currentUser, onOpenBetChat }: SportsViewProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState("");

  const [sport, setSport] = useState<SportKind>("nba");
  const [games, setGames] = useState<ScoreboardGame[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<ScoreboardGame | null>(null);

  const [backsHome, setBacksHome] = useState(true);
  const [stake, setStake] = useState("0.1");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postSuccess, setPostSuccess] = useState<string | null>(null);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === groupId) ?? null,
    [groupId, groups],
  );
  const backedTeam = selectedGame ? (backsHome ? selectedGame.homeTeam : selectedGame.awayTeam) : "";
  const canPost = Boolean(selectedGroup && selectedGame && Number(stake) > 0 && !posting);

  useEffect(() => {
    let alive = true;
    setGroupsLoading(true);
    setGroupsError(null);
    getGroups()
      .then(({ groups: nextGroups }) => {
        if (!alive) return;
        setGroups(nextGroups);
        setGroupId((prev) => prev || nextGroups[0]?.id || "");
      })
      .catch((err) => {
        if (!alive) return;
        setGroupsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setGroupsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setGamesLoading(true);
    setGamesError(null);
    setSelectedGame(null);
    setPostError(null);
    setPostSuccess(null);

    getScoreboard(sport)
      .then(({ games: nextGames }) => {
        if (!alive) return;
        setGames(nextGames);
      })
      .catch((err) => {
        if (!alive) return;
        setGamesError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setGamesLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [sport]);

  async function postSportsBet(): Promise<void> {
    if (!selectedGroup || !selectedGame || !canPost) return;

    setPosting(true);
    setPostError(null);
    setPostSuccess(null);
    try {
      const terms = `${SPORT_LABELS[sport]}: ${selectedGame.awayTeam} @ ${selectedGame.homeTeam} — ${currentUser.username} backs ${backedTeam}.`;
      const { bet } = await createBet({
        groupId: selectedGroup.id,
        type: "DEV",
        acceptor: "anyone",
        terms,
        stake: stake.trim(),
        currency: "SOL",
        witnesses: Math.max(2, Math.ceil(selectedGroup.members / 2)),
        minBettors: 2,
        sport,
        gameId: selectedGame.gameId,
        backsHome,
        homeTeam: selectedGame.homeTeam,
        awayTeam: selectedGame.awayTeam,
      });
      setPostSuccess(`Posted to ${selectedGroup.name}.`);
      if (onOpenBetChat) onOpenBetChat(selectedGroup.id, bet.id);
    } catch (err) {
      setPostError(err instanceof Error ? err.message : String(err));
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border p-4" style={{ background: "var(--card)" }}>
        <div className="flex flex-wrap items-center gap-2.5">
          <Pill color="teal">
            <Trophy size={8} />
            SPORTS BOARD
          </Pill>
          <Mono className="text-muted-foreground" style={{ fontSize: "10px" } as React.CSSProperties}>
            Select a league, pick a game, then post it straight into your group chat.
          </Mono>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-border p-4 space-y-3" style={{ background: "var(--card)" }}>
          <div className="flex items-center justify-between">
            <Mono className="text-muted-foreground uppercase" style={{ fontSize: "9px", letterSpacing: "0.1em" } as React.CSSProperties}>
              1) Choose sport
            </Mono>
            {gamesLoading && <RefreshCw size={12} className="animate-spin text-muted-foreground" />}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {SPORTS.map((value) => (
              <button
                key={value}
                onClick={() => setSport(value)}
                className="px-3 py-2 rounded-xl border transition-all duration-150"
                style={{
                  background: sport === value ? "rgba(153,69,255,0.12)" : "var(--muted)",
                  borderColor: sport === value ? "rgba(153,69,255,0.45)" : "var(--border)",
                  color: sport === value ? "#9945FF" : "var(--muted-foreground)",
                  fontSize: "12px",
                  fontWeight: sport === value ? 700 : 500,
                }}
              >
                {SPORT_LABELS[value]}
              </button>
            ))}
          </div>

          <Mono className="text-muted-foreground uppercase block mt-2" style={{ fontSize: "9px", letterSpacing: "0.1em" } as React.CSSProperties}>
            2) Pick game
          </Mono>
          <div className="max-h-80 overflow-y-auto pr-1 space-y-2">
            {gamesLoading && (
              <p className="text-muted-foreground text-center py-6" style={{ fontSize: "11px" }}>
                Loading {SPORT_LABELS[sport]} games…
              </p>
            )}
            {gamesError && (
              <p className="text-center py-6" style={{ fontSize: "11px", color: "#FF7E7E" }}>
                {gamesError}
              </p>
            )}
            {!gamesLoading && !gamesError && games.length === 0 && (
              <p className="text-muted-foreground text-center py-6" style={{ fontSize: "11px" }}>
                No {SPORT_LABELS[sport]} games available right now.
              </p>
            )}
            {games.map((game) => {
              const selected = selectedGame?.gameId === game.gameId;
              const kickoff = game.startTime
                ? new Date(game.startTime).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : game.status || "Scheduled";
              return (
                <motion.button
                  key={game.gameId}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => {
                    setSelectedGame(game);
                    setBacksHome(true);
                    setPostError(null);
                    setPostSuccess(null);
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl border transition-colors"
                  style={{
                    background: selected ? "rgba(153,69,255,0.1)" : "var(--muted)",
                    borderColor: selected ? "rgba(153,69,255,0.45)" : "var(--border)",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground truncate" style={{ fontSize: "12px", fontWeight: 600 }}>
                      {game.awayTeam} @ {game.homeTeam}
                    </span>
                    <Mono className="text-muted-foreground shrink-0" style={{ fontSize: "9px" } as React.CSSProperties}>
                      {kickoff}
                    </Mono>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border p-4 space-y-3" style={{ background: "var(--card)" }}>
          <Mono className="text-muted-foreground uppercase" style={{ fontSize: "9px", letterSpacing: "0.1em" } as React.CSSProperties}>
            3) Post to group
          </Mono>

          <label className="block text-muted-foreground" style={{ fontSize: "11px" }}>
            Group chat
          </label>
          <select
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            disabled={groupsLoading || groups.length === 0}
            className="w-full rounded-xl border border-border px-3 py-2 bg-muted text-foreground outline-none"
            style={{ fontSize: "12px" }}
          >
            {groups.length === 0 && <option value="">{groupsLoading ? "Loading groups..." : "No groups found"}</option>}
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} ({group.members})
              </option>
            ))}
          </select>
          {groupsError && (
            <p style={{ fontSize: "11px", color: "#FF7E7E" }}>
              {groupsError}
            </p>
          )}

          <div className="rounded-xl border border-border p-3" style={{ background: "var(--muted)" }}>
            {selectedGame ? (
              <div className="space-y-2">
                <p className="text-foreground" style={{ fontSize: "13px", fontWeight: 700 }}>
                  {selectedGame.awayTeam} @ {selectedGame.homeTeam}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: false, label: "Away", team: selectedGame.awayTeam },
                    { value: true, label: "Home", team: selectedGame.homeTeam },
                  ].map((option) => (
                    <button
                      key={option.team}
                      onClick={() => setBacksHome(option.value)}
                      className="px-2.5 py-2 rounded-lg border text-left transition-colors"
                      style={{
                        background: backsHome === option.value ? "rgba(20,241,149,0.1)" : "transparent",
                        borderColor: backsHome === option.value ? "rgba(20,241,149,0.45)" : "var(--border)",
                      }}
                    >
                      <Mono className="text-muted-foreground block" style={{ fontSize: "8px" } as React.CSSProperties}>
                        {option.label.toUpperCase()}
                      </Mono>
                      <span className="text-foreground block truncate" style={{ fontSize: "12px", fontWeight: 700 }}>
                        {option.team}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground" style={{ fontSize: "11px" }}>
                Pick a game from the board to continue.
              </p>
            )}
          </div>

          <label className="block text-muted-foreground" style={{ fontSize: "11px" }}>
            Stake (SOL)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={stake}
            onChange={(event) => setStake(event.target.value)}
            className="w-full rounded-xl border border-border px-3 py-2 bg-muted text-foreground outline-none"
            style={{ fontSize: "12px" }}
          />

          {postError && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/8 px-3 py-2 flex items-start gap-2">
              <AlertCircle size={13} style={{ color: "#FF7E7E", marginTop: 1, flexShrink: 0 }} />
              <span style={{ fontSize: "11px", color: "#FFB4B4" }}>{postError}</span>
            </div>
          )}
          {postSuccess && (
            <div className="rounded-lg border border-[#14F195]/25 bg-[#14F195]/8 px-3 py-2 flex items-start gap-2">
              <CheckCircle2 size={13} style={{ color: "#14F195", marginTop: 1, flexShrink: 0 }} />
              <span style={{ fontSize: "11px", color: "#8CF7CB" }}>{postSuccess}</span>
            </div>
          )}

          <button
            onClick={() => { void postSportsBet(); }}
            disabled={!canPost}
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: canPost ? "linear-gradient(135deg, #9945FF, #14F195)" : "var(--muted)",
              color: canPost ? "#fff" : "var(--muted-foreground)",
              fontSize: "12px",
            }}
          >
            {posting ? "Posting…" : "Post sports bet to chat"}
            {!posting && <ChevronRight size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
}
