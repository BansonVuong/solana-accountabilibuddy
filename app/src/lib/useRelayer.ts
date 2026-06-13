import { useEffect, useRef, useState } from "react";
import { getHealth, type RelayerHealth } from "./relayer";

export interface RelayerStatus {
  /** Whether the last poll reached the relayer. */
  connected: boolean;
  /** True until the first poll resolves/rejects. */
  loading: boolean;
  health: RelayerHealth | null;
  error: string | null;
}

/**
 * Polls the relayer's /health endpoint so the dashboard can reflect the real
 * connection state, oracle/program identity, and live cluster slot. Falls back
 * gracefully (connected: false) when the relayer isn't running, so the UI
 * still renders standalone.
 */
export function useRelayerHealth(pollMs = 4000): RelayerStatus {
  const [status, setStatus] = useState<RelayerStatus>({
    connected: false,
    loading: true,
    health: null,
    error: null,
  });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;

    async function poll() {
      try {
        const health = await getHealth();
        if (!alive.current) return;
        setStatus({ connected: true, loading: false, health, error: null });
      } catch (err) {
        if (!alive.current) return;
        setStatus((prev) => ({
          connected: false,
          loading: false,
          health: prev.health,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }

    void poll();
    const id = setInterval(poll, pollMs);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [pollMs]);

  return status;
}
