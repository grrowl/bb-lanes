import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  experimental_useProviders,
  experimental_useSidebarThreads,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type PluginProvidersState,
  type PluginSidebarThread,
  type PluginSidebarThreadsState,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { LANES_CHANGED, type BlockDetail, type LaneBlock, type LaneHandoff, type LanesChangedSignal } from "../../../shared/model";
import type { rpcContract } from "../../../shared/rpc";
import { MINUTE } from "../time";
import {
  applySignal,
  cacheFromSnapshot,
  isInvalidation,
  isProvisional,
  overlayLiveState,
  parseSignal,
  settleOverrides,
  type DecisionOverride,
  type LanesCache,
} from "./snapshot";

/** Reconcile even when every signal arrived, in case one was dropped. */
const SAFETY_REFETCH_MS = 60_000;
/** How long an answered approval may show running without the server agreeing. */
const OVERRIDE_MAX_AGE_MS = 60_000;
/** Window starts snap to this grid so a sliding window does not refetch every tick. */
const SINCE_QUANTUM_MS = MINUTE;
/** Clock corrections smaller than this are network jitter, not skew. */
const SKEW_TOLERANCE_MS = 250;
/** The RPC accepts at most this many thread ids; larger scopes filter client-side. */
const MAX_SCOPED_THREADS = 500;

export type ProviderInfo = PluginProvidersState["providers"][number];

export interface LanesDataOptions {
  /** Earliest time the caller needs history for (server time). */
  since: number;
  /** Narrow to these threads; omit for every thread. */
  threadIds?: readonly string[] | null;
}

export interface LanesData {
  status: "loading" | "ready" | "error";
  error: string | null;
  reconnecting: boolean;
  sidebar: PluginSidebarThreadsState;
  threadsById: ReadonlyMap<string, PluginSidebarThread>;
  providers: readonly ProviderInfo[];
  /** History with the sidebar's live state laid over it. */
  blocks: LaneBlock[];
  handoffs: LaneHandoff[];
  /** The server is still backfilling older history. */
  indexing: boolean;
  /** Server clock minus client clock, in ms. */
  skew: number;
  refetch(): void;
  decide(block: LaneBlock, decision: "approve" | "reject"): Promise<void>;
  loadDetail(block: LaneBlock): Promise<BlockDetail>;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function useLanesData({ since, threadIds }: LanesDataOptions): LanesData {
  const rpc = useRpc<typeof rpcContract>();
  const sidebar = experimental_useSidebarThreads();
  const { providers } = experimental_useProviders();
  const connection = useRealtimeConnectionState();

  const scopeKey = threadIds == null ? null : [...new Set(threadIds)].sort().join("\n");
  const scope = useMemo(
    () => (scopeKey === null ? null : new Set(scopeKey === "" ? [] : scopeKey.split("\n"))),
    [scopeKey],
  );

  const [cache, setCache] = useState<LanesCache | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skew, setSkew] = useState(0);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, DecisionOverride>>(() => new Map());

  /** Window start of the latest request (in flight or landed); null forces a load. */
  const loadedSince = useRef<number | null>(null);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  /** Signals that arrived while a snapshot was in flight, replayed onto it. */
  const pendingSignals = useRef<LanesChangedSignal[]>([]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const load = useCallback(
    (requestedSince: number) => {
      const currentScope = scopeRef.current;
      const request = ++sequence.current;
      inFlight.current = true;
      loadedSince.current = requestedSince;
      const sentAt = Date.now();
      const input =
        currentScope === null || currentScope.size > MAX_SCOPED_THREADS
          ? { since: requestedSince }
          : { since: requestedSince, threadIds: [...currentScope] };
      rpc.call("lanes_window", input).then(
        (snapshot) => {
          if (request !== sequence.current) return;
          const receivedAt = Date.now();
          let next = cacheFromSnapshot(snapshot, currentScope);
          for (const signal of pendingSignals.current) {
            if (signal.generatedAt > snapshot.generatedAt) next = applySignal(next, signal, currentScope);
          }
          pendingSignals.current = [];
          inFlight.current = false;
          // Assume the server cut the snapshot halfway through the round trip,
          // and ignore jitter so the window does not twitch on every refetch.
          const measured = snapshot.generatedAt - (sentAt + receivedAt) / 2;
          setSkew((current) => (Math.abs(measured - current) > SKEW_TOLERANCE_MS ? measured : current));
          setCache(next);
          setError(null);
        },
        (cause: unknown) => {
          if (request !== sequence.current) return;
          pendingSignals.current = [];
          inFlight.current = false;
          loadedSince.current = null;
          setError(errorMessage(cause));
        },
      );
    },
    [rpc],
  );

  const quantizedSince = Math.floor(since / SINCE_QUANTUM_MS) * SINCE_QUANTUM_MS;
  const quantizedSinceRef = useRef(quantizedSince);
  quantizedSinceRef.current = quantizedSince;

  const refetch = useCallback(() => {
    load(Math.min(loadedSince.current ?? Infinity, quantizedSinceRef.current));
  }, [load]);

  // Load on mount, when the scope changes, and when the window reaches
  // further back than what is loaded. A narrower window keeps the history.
  const loadedScopeKey = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const scopeChanged = loadedScopeKey.current !== scopeKey;
    loadedScopeKey.current = scopeKey;
    const loaded = loadedSince.current;
    if (loaded === null || scopeChanged || quantizedSince < loaded) {
      load(Math.min(quantizedSince, loaded ?? quantizedSince));
    }
  }, [quantizedSince, scopeKey, load]);

  useRealtime(LANES_CHANGED, (payload) => {
    const signal = parseSignal(payload);
    if (signal === null || isInvalidation(signal)) {
      refetch();
      return;
    }
    if (inFlight.current) pendingSignals.current.push(signal);
    setCache((current) => (current === null ? current : applySignal(current, signal, scopeRef.current)));
  });

  // Signals are not replayed after a dropped connection: reconcile on every
  // reconnect, but not on the first connection.
  const everConnected = useRef(false);
  const previousConnection = useRef(connection);
  useEffect(() => {
    const previous = previousConnection.current;
    previousConnection.current = connection;
    if (connection !== "connected") return;
    if (everConnected.current && previous !== "connected") refetch();
    everConnected.current = true;
  }, [connection, refetch]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refetch();
    }, SAFETY_REFETCH_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refetch]);

  useEffect(() => {
    if (cache === null || overrides.size === 0) return;
    const settled = settleOverrides(overrides, cache.blocks, Date.now(), OVERRIDE_MAX_AGE_MS);
    if (settled !== null) setOverrides(settled);
  }, [cache, overrides]);

  const threadsById = useMemo(
    () => new Map(sidebar.threads.map((thread) => [thread.id, thread])),
    [sidebar.threads],
  );

  const blocks = useMemo(() => {
    if (cache === null) return [];
    const liveThreads =
      scope === null
        ? threadsById
        : new Map([...threadsById].filter(([id]) => scope.has(id)));
    return overlayLiveState(cache.blocks.values(), liveThreads, overrides);
  }, [cache, threadsById, overrides, scope]);

  const handoffs = useMemo(() => (cache === null ? [] : [...cache.handoffs.values()]), [cache]);

  const decide = useCallback(
    async (block: LaneBlock, decision: "approve" | "reject") => {
      const interactionId = block.ask?.interactionId ?? null;
      if (interactionId === null) {
        toast.error("Answer this one in the thread");
        return;
      }
      setOverrides((current) =>
        new Map(current).set(block.id, { blockId: block.id, interactionId, at: Date.now() }),
      );
      try {
        const result = await rpc.call("lanes_decide", { threadId: block.threadId, interactionId, decision });
        if (!result.ok) throw new Error(result.message ?? "bb did not accept the answer.");
      } catch (cause) {
        setOverrides((current) => {
          const next = new Map(current);
          next.delete(block.id);
          return next;
        });
        toast.error(decision === "approve" ? "Could not approve" : "Could not reject", {
          description: errorMessage(cause),
        });
      }
    },
    [rpc],
  );

  const loadDetail = useCallback(
    (block: LaneBlock): Promise<BlockDetail> =>
      isProvisional(block)
        ? Promise.resolve({ blockId: block.id, threadId: block.threadId, summary: [], prompt: "", recent: [] })
        : rpc.call("lanes_block_detail", { threadId: block.threadId, blockId: block.id }),
    [rpc],
  );

  return {
    status: cache !== null ? "ready" : error !== null ? "error" : "loading",
    error,
    reconnecting: connection !== "connected",
    sidebar,
    threadsById,
    providers,
    blocks,
    handoffs,
    indexing: cache?.indexing ?? false,
    skew,
    refetch,
    decide,
    loadDetail,
  };
}

/** The server's clock, ticking every `intervalMs` while the page is visible. */
export function useServerNow(skew: number, intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    const tick = () => setNow(Date.now() + skew);
    tick();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") tick();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [skew, intervalMs]);
  return now;
}
