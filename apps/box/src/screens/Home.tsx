import { Mark } from '@huddle/ui';
import { useEffect, useState } from 'react';
import { Icon, StatusLine, Wordmark } from '../components/ui';
import { api, type HealthResponse } from '../lib/api';
import { healthChips } from '../lib/health';
import { useBox } from '../store';

export function useHealth(pollMs = 5000) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [offline, setOffline] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .health()
        .then((h) => alive && (setHealth(h), setOffline(false)))
        .catch(() => alive && setOffline(true));
    void load();
    const t = setInterval(load, pollMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pollMs, n]);
  return { health, offline, retry: () => setN((x) => x + 1) };
}

export function Home() {
  const setScreen = useBox((s) => s.setScreen);
  const { health, offline, retry } = useHealth();
  const chips = health || offline ? healthChips(health, offline) : [];
  const warn = chips.find((c) => c.tone === 'warn' && c.hint);
  return (
    <main className="relative flex h-full overflow-hidden">
      <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-between px-14 pb-10 pt-10">
        <Wordmark className="hd-fade text-title" />
        <div>
          <h1 className="hd-rise font-display text-[5.25rem] font-black leading-[0.86] tracking-[-0.035em] text-balance" style={{ fontStretch: '75%' }}>
            Call every moment.
            <br />
            <span className="text-night-400">Settle every bet.</span>
          </h1>
          <p className="hd-rise mt-5 max-w-[30rem] text-lead text-night-200" style={{ ['--d' as string]: '120ms' }}>
            One box, one pot, every phone in the room. Questions open the second the game gives you one.
          </p>
          <div className="hd-rise mt-8 flex items-center gap-5" style={{ ['--d' as string]: '200ms' }}>
            <button
              type="button"
              className="btn-primary min-h-[4.5rem] px-10 text-title"
              onClick={() => setScreen('create')}
              data-testid="start-party"
              disabled={offline}
            >
              Start a party
              <Icon name="arrowRight" className="h-7 w-7" strokeWidth={2.6} />
            </button>
            {offline && (
              <button type="button" className="btn-secondary min-h-[4.5rem] px-6" onClick={retry}>
                <Icon name="refresh" className="h-5 w-5" /> Try again
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2" aria-live="polite">
          {chips.length > 0 ? <StatusLine chips={chips} /> : <p className="text-body text-night-400">Checking the engine…</p>}
          {warn && <p className="max-w-[44rem] text-body text-night-400">{warn.hint}</p>}
        </div>
      </div>
      {/* The box's LED ring, big: the brand, and the thing on the table. */}
      <div className="pointer-events-none absolute -right-[10rem] top-1/2 -translate-y-1/2" aria-hidden="true">
        <Mark size="34rem" lit={offline ? 0 : 1} spin={!health && !offline} className="text-night-700" />
      </div>
    </main>
  );
}
