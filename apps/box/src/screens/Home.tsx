import { Aurora, Kinetic, Mark } from '@huddle/ui';
import { useEffect, useState } from 'react';
import { Icon, StatusLine, Wordmark } from '../components/ui';
import { api, type HealthResponse } from '../lib/api';
import { engineBase } from '../lib/config';
import { WAKING_CHIP, engineIsLocal, healthChips } from '../lib/health';
import { useBox } from '../store';

export function useHealth(pollMs = 5000) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [offline, setOffline] = useState(false);
  /** The first answer is slow (a hosted engine waking from sleep): say so instead of "offline". */
  const [waking, setWaking] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const load = () => {
      if (inFlight) return; // one request at a time: a waking engine answers the one already waiting
      inFlight = true;
      const slow = setTimeout(() => alive && setWaking(true), 2500);
      api
        .health()
        .then((h) => alive && (setHealth(h), setOffline(false)))
        .catch(() => alive && setOffline(true))
        .finally(() => {
          inFlight = false;
          clearTimeout(slow);
          if (alive) setWaking(false);
        });
    };
    load();
    const t = setInterval(load, pollMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pollMs, n]);
  return { health, offline, waking, retry: () => setN((x) => x + 1) };
}

export function Home() {
  const setScreen = useBox((s) => s.setScreen);
  const { health, offline, waking, retry } = useHealth();
  const local = engineIsLocal(engineBase());
  const chips = waking && !health ? [WAKING_CHIP] : health || offline ? healthChips(health, offline, local) : [];
  const warn = chips.find((c) => c.tone === 'warn' && c.hint);
  return (
    <main className="relative flex h-full overflow-hidden bg-canvas">
      <Aurora />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-between px-14 pb-10 pt-10">
        <Wordmark className="hd-drop text-title" lit={12} />
        <div>
          <h1 className="font-head text-[5.25rem] font-extrabold leading-[0.9] tracking-[-0.045em]">
            <Kinetic text="Call every moment." className="block" delay={80} />
            <Kinetic text="Settle every bet." className="block text-zap" delay={330} />
          </h1>
          <p className="hd-rise mt-5 max-w-[30rem] text-lead text-ink-2" style={{ ['--d' as string]: '620ms' }}>
            One box, one pot, every phone in the room. Questions open the second the game gives you one.
          </p>
          <div className="hd-rise mt-8 flex items-center gap-5" style={{ ['--d' as string]: '760ms' }}>
            <button
              type="button"
              className="btn-prime min-h-[4.75rem] rounded-panel px-10 text-title"
              onClick={() => setScreen('create')}
              data-testid="start-party"
              disabled={offline}
            >
              Start a party
              <Icon name="arrowRight" className="h-7 w-7" strokeWidth={2.6} />
            </button>
            {offline && (
              <button type="button" className="btn-secondary min-h-[4.75rem] px-6" onClick={retry}>
                <Icon name="refresh" className="h-5 w-5" /> Try again
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2" aria-live="polite">
          {chips.length > 0 ? <StatusLine chips={chips} /> : <p className="text-body text-ink-muted">Checking the engine…</p>}
          {warn && <p className="max-w-[44rem] text-body text-ink-2">{warn.hint}</p>}
        </div>
      </div>
      {/* The box's LED ring, big: the brand, and the thing on the table. */}
      <div className="pointer-events-none absolute -right-[9rem] top-1/2 -translate-y-1/2" aria-hidden="true">
        <div className="hd-zoom" style={{ ['--d' as string]: '200ms' }}>
          <div className="hd-float">
            <Mark size="34rem" lit={offline ? 0 : 12} spin={!health && !offline} className="text-rule-strong" />
          </div>
        </div>
      </div>
    </main>
  );
}
