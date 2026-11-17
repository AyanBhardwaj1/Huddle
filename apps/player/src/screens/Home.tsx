import type { Party } from '@huddle/shared';
import { Icon, Wordmark } from '@huddle/ui';
import { useCallback, useEffect, useState } from 'react';
import { Loading } from '../components/primitives';
import { listParties } from '../lib/api';
import { useApp } from '../lib/session';

/**
 * Home: parties on now (one tap in), and the code field in the thumb zone. Everything you can do
 * here is at the bottom half of the screen.
 */
export function Home() {
  const navigate = useApp((s) => s.navigate);
  const [code, setCode] = useState('');
  const [parties, setParties] = useState<Party[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tried, setTried] = useState(false);

  const load = useCallback(
    (alive: () => boolean) =>
      listParties()
        .then((r) => {
          if (!alive()) return;
          setParties(r.parties.filter((p) => p.status === 'live' || p.status === 'lobby'));
          setFailed(false);
        })
        .catch(() => alive() && setFailed(true)),
    [],
  );

  useEffect(() => {
    let on = true;
    const alive = () => on;
    void load(alive);
    const t = setInterval(() => void load(alive), 10_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [load]);

  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const ready = clean.length >= 3;

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+2rem)]">
      <header>
        <Wordmark className="hd-rise text-head" />
        <p className="hd-rise mt-5 max-w-[22ch] text-balance font-display text-title font-bold stretch-semi text-ink-2" style={{ ['--d' as string]: '80ms' }}>
          Call every moment of the game with your friends.
        </p>
      </header>

      <section className="mt-10 flex-1" aria-labelledby="on-now">
        <h2 id="on-now" className="mb-3 text-small text-ink-muted">
          Parties on now
        </h2>
        {parties === null && !failed && <Loading className="py-3 text-small">Looking for parties nearby…</Loading>}
        {failed && parties === null && (
          <div className="rounded-panel bg-card p-4">
            <p className="text-pretty text-small text-ink-2">Can't reach the party box right now. Type the code from the box, or open the invite link again.</p>
            <button onClick={() => void load(() => true)} className="btn-secondary mt-3">
              <Icon name="refresh" size={18} /> Try again
            </button>
          </div>
        )}
        {parties?.length === 0 && <p className="text-pretty text-body text-ink-muted">No parties right now. Ask the host for the code on the box.</p>}
        {!!parties?.length && (
          <ul className="overflow-hidden rounded-panel bg-card">
            {parties.map((p, i) => (
              <li key={p.id} className={i > 0 ? 'border-t border-rule' : undefined}>
                <a
                  href={`/j/${p.code}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    navigate(`/j/${p.code}`);
                  }}
                  className="hd-rise flex min-h-16 items-center gap-3 px-4 py-3 transition-colors duration-quick hover:bg-well"
                  style={{ ['--d' as string]: `${i * 50}ms` }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold text-ink">{p.name}</div>
                    <div className="flex items-center gap-2 truncate text-small text-ink-muted">
                      {p.status === 'live' ? (
                        <span className="flex shrink-0 items-center gap-1.5 text-ink-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-hot" aria-hidden="true" /> Live
                        </span>
                      ) : (
                        <span className="shrink-0">In the lobby</span>
                      )}
                      <span className="truncate">{p.game.title}</span>
                    </div>
                  </div>
                  <span className="font-display text-lead font-extrabold stretch-wide text-ink" translate="no">
                    {p.code}
                  </span>
                  <Icon name="arrowRight" size={20} className="shrink-0 text-ink-muted" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form
        className="mt-10"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (ready) navigate(`/j/${clean}`);
        }}
        noValidate
      >
        <label htmlFor="code" className="block text-small text-ink-2">
          Got a code? It's on the box.
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="code"
            name="party-code"
            value={clean}
            onChange={(e) => {
              setCode(e.target.value);
              setTried(false);
            }}
            placeholder="ABCD"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            enterKeyHint="go"
            aria-invalid={tried && !ready}
            aria-describedby="code-hint"
            className="field h-14 min-w-0 flex-1 font-display text-title font-extrabold uppercase tracking-[0.18em] stretch-wide placeholder:tracking-[0.18em]"
            translate="no"
          />
          <button type="submit" className="btn-primary w-24 shrink-0 px-0" aria-label="Join party">
            Join
          </button>
        </div>
        <p id="code-hint" className="mt-2 flex items-center gap-1.5 text-small text-ink-muted">
          {tried && !ready ? (
            'Party codes are at least 3 letters.'
          ) : (
            <>
              <Icon name="nfc" size={16} /> Or tap your phone on the box.
            </>
          )}
        </p>
      </form>

      <p className="mt-8 text-center text-cap text-ink-muted">Test money and points only. No real-money betting.</p>
    </div>
  );
}
