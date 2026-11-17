import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Chip, Icon, Wordmark } from '../components/ui';
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
    <div className="relative flex h-full flex-col items-center justify-center gap-7 overflow-hidden px-8">
      {/* stadium light wash */}
      <div className="pointer-events-none absolute -top-[30%] left-1/2 h-[80%] w-[90%] -translate-x-1/2 rounded-[50%] bg-volt/[0.07] blur-3xl" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%] bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.025)_0_4rem,transparent_4rem_8rem)]" />
      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="relative text-center">
        <Wordmark className="text-[8rem]" />
        <p className="mt-1 font-display text-[1.9rem] font-medium uppercase tracking-[0.2em] text-pitch-200">
          Call every moment. Settle every bet.
        </p>
      </motion.div>
      <motion.button
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="btn-volt relative min-h-[5.5rem] px-14 text-[2.6rem]"
        onClick={() => setScreen('create')}
        data-testid="start-party"
        disabled={offline}
      >
        Start a party
        <Icon name="next" className="h-8 w-8" />
      </motion.button>
      <div className="relative flex max-w-[56rem] flex-wrap items-center justify-center gap-2">
        {chips.map((c) => (
          <Chip key={c.id} chip={c} />
        ))}
        {offline && (
          <button className="btn-ghost min-h-[2.2rem] px-3 text-[1rem]" onClick={retry}>
            Retry
          </button>
        )}
        {!health && !offline && <span className="text-[0.9rem] text-pitch-400">Checking the engine…</span>}
      </div>
      {warn && (
        <p className="relative flex items-center gap-2 text-[0.95rem] text-down">
          <Icon name="warn" className="h-4 w-4" />
          {warn.hint}
        </p>
      )}
    </div>
  );
}
