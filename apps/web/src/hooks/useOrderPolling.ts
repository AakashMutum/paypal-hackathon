import { useCallback, useEffect, useState } from 'react';
import type { Investigation } from '../types';
import { api } from '../api/apiClient';
export function useOrderPolling(id?: string) {
  const [inv, setInv] = useState<Investigation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!id) { setInv(null); return; }
    let stop = false, t: number;
    const run = async () => {
      const s = performance.now();
      try {
        const r = await api.getInvestigation(id);
        if (stop) return;
        setInv(r); setLatency(Math.round(performance.now() - s)); setError(null);
        if (r.status === 'RUNNING' || r.status === 'QUEUED') t = window.setTimeout(run, 800);
      } catch (e) { if (!stop) { setError((e as Error).message); t = window.setTimeout(run, 2000); } }
    };
    run();
    return () => { stop = true; clearTimeout(t); };
  }, [id, tick]);
  return { inv, error, latency, refresh: useCallback(() => setTick(x => x + 1), []) };
}
export function useInvestigations(poll = 0) {
  const [list, setList] = useState<Investigation[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => api.listInvestigations().then(setList).catch(() => {}).finally(() => setLoading(false)), []);
  useEffect(() => { load(); if (!poll) return; const t = setInterval(load, poll); return () => clearInterval(t); }, [load, poll]);
  return { list, loading, reload: load };
}
