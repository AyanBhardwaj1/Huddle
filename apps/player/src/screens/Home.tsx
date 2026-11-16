import type { Party } from '@huddle/shared';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { cx } from '../components/ctx';
import { Icon, Spinner } from '../components/Icon';
import { listParties } from '../lib/api';
import { useApp } from '../lib/session';

/** Home: type a party code or pick an active party. */
export function Home() {
  const navigate = useApp((s) => s.navigate);
  const [code, setCode] = useState('');
  const [parties, setParties] = useState<Party[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      listParties()
        .then((r) => alive && (setParties(r.parties.filter((p) => p.status === 'live' || p.status === 'lobby')), setFailed(false)))
        .catch(() => alive && setFailed(true));
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-6 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+40px)]">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-12 w-12" />
          <span className="font-display text-5xl font-bold uppercase tracking-tight">Huddle</span>
        </div>
        <p className="mt-4 text-xl leading-snug text-pitch-200">
          Bet on every moment of the game with your friends. <span className="text-volt">One tap.</span>
        </p>
      </motion.div>

      <form
        className="mt-10"
        onSubmit={(e) => {
          e.preventDefault();
          if (clean.length >= 3) navigate(`/j/${clean}`);
        }}
      >
        <label htmlFor="code" className="text-xs font-semibold uppercase tracking-[0.16em] text-pitch-400">
          Party code
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="code"
            value={clean}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABCD"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            enterKeyHint="go"
            className="h-16 min-w-0 flex-1 rounded-2xl border border-pitch-700 bg-pitch-900 px-5 font-display text-3xl font-bold uppercase tracking-[0.3em] text-pitch-50 placeholder:text-pitch-600 focus:border-volt focus:outline-none"
          />
          <button
            type="submit"
            disabled={clean.length < 3}
            className="grid h-16 w-16 place-items-center rounded-2xl bg-volt text-volt-ink transition-opacity disabled:opacity-30"
            aria-label="Join party"
          >
            <Icon name="up" className="rotate-90" size={26} />
          </button>
        </div>
        <p className="mt-2 text-sm text-pitch-400">Or tap your phone on the box.</p>
      </form>

      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-pitch-400">Parties on now</h2>
        <div className="mt-3 space-y-2">
          {parties === null && !failed && (
            <div className="flex items-center gap-2 text-sm text-pitch-400">
              <Spinner size={16} /> Looking for parties…
            </div>
          )}
          {failed && <p className="text-sm text-pitch-400">Can't reach the party box right now. Use a code or an invite link.</p>}
          {parties?.length === 0 && <p className="text-sm text-pitch-400">No parties right now. Ask the host for a code.</p>}
          {parties?.map((p) => (
            <button
              key={p.id}
              onClick={() => navigate(`/j/${p.code}`)}
              className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-pitch-700 bg-pitch-900 px-4 py-3 text-left active:bg-pitch-800"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{p.name}</div>
                <div className="truncate text-sm text-pitch-400">{p.game.title}</div>
              </div>
              <span className={cx('rounded-lg px-2 py-1 font-display text-lg font-bold tracking-widest', 'bg-pitch-800 text-volt')}>{p.code}</span>
            </button>
          ))}
        </div>
      </section>

      <p className="mt-auto pt-10 text-center text-xs text-pitch-400">Test money and points only. No real-money betting.</p>
    </div>
  );
}
