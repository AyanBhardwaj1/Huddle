import type { Party } from '@huddle/shared';
import { Icon, Kinetic, Wordmark } from '@huddle/ui';
import { useCallback, useEffect, useState } from 'react';
import { Backdrop, Loading } from '../components/primitives';
import { listParties } from '../lib/api';
import { useApp } from '../lib/session';

const d = (ms: number) => ({ ['--d' as string]: `${ms}ms` });

/**
 * Home: a kinetic headline, parties on now (one tap in), and the code field in the thumb zone.
 * Everything you can do here sits in the bottom half of the screen.
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
    <div className="relative min-h-[100dvh]">
      <Backdrop />
      <div className="relative z-[1] mx-auto flex min-h-[100dvh] max-w-md flex-col px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+1.75rem)]">
        <header>
          <Wordmark className="hd-pop text-title" lit={3} />
          <Kinetic as="h1" text="Your phone is the controller." className="q mt-8 block text-[2.75rem] leading-[0.98] tracking-[-0.04em] text-ink" delay={120} stagger={60} />
          <p className="hd-rise mt-3 max-w-[30ch] text-pretty text-body text-ink-2" style={d(520)}>
            Call every moment of the game with your friends: one tap per question, the odds live, the pot settled for you.
          </p>
        </header>

        <section className="mt-9 flex-1" aria-labelledby="on-now">
          <h2 id="on-now" className="mb-3 flex items-center gap-2 font-head text-lead font-extrabold text-ink">
            Parties on now
            {!!parties?.length && <span className="num grid h-6 min-w-6 place-items-center rounded-full bg-zap-100 px-1.5 text-small text-zap-deep">{parties.length}</span>}
          </h2>
          {parties === null && !failed && <Loading className="py-3 text-small">Looking for parties nearby…</Loading>}
          {failed && parties === null && (
            <div className="card p-4">
              <p className="text-pretty text-small text-ink-2">Can't reach the party box right now. Type the code from the box, or open the invite link again.</p>
              <button onClick={() => void load(() => true)} className="btn-secondary mt-3">
                <Icon name="refresh" size={18} /> Try again
              </button>
            </div>
          )}
          {parties?.length === 0 && (
            <p className="rounded-panel border-2 border-dashed border-rule px-4 py-5 text-pretty text-body text-ink-muted">
              No parties right now. Ask the host for the code on the box.
            </p>
          )}
          {!!parties?.length && (
            <ul className="space-y-2.5">
              {parties.map((p, i) => (
                <li key={p.id} className="hd-rise" style={d(200 + i * 70)}>
                  <a
                    href={`/j/${p.code}`}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      navigate(`/j/${p.code}`);
                    }}
                    className="hd-press card flex min-h-[4.5rem] items-center gap-3 px-4 py-3 hover:-translate-y-0.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-head text-lead font-extrabold text-ink">{p.name}</div>
                      <div className="flex items-center gap-2 truncate text-small text-ink-muted">
                        {p.status === 'live' ? (
                          <span className="flex shrink-0 items-center gap-1.5 font-semibold text-ink-2">
                            <span className="live-dot h-2 w-2 rounded-full bg-hot" aria-hidden="true" /> Live
                          </span>
                        ) : (
                          <span className="shrink-0">In the lobby</span>
                        )}
                        <span className="truncate">{p.game.title}</span>
                      </div>
                    </div>
                    <CodeTiles code={p.code} small />
                    <Icon name="arrowRight" size={20} className="shrink-0 text-zap" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form
          className="hd-rise mt-9"
          style={d(380)}
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (ready) navigate(`/j/${clean}`);
          }}
          noValidate
        >
          <label htmlFor="code" className="block font-head text-lead font-extrabold text-ink">
            Got a code? It's on the box.
          </label>
          <div className="mt-2.5 flex gap-2">
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
              className="field num h-14 min-w-0 flex-1 text-title uppercase tracking-[0.22em] placeholder:tracking-[0.22em]"
              translate="no"
            />
            <button type="submit" className="btn-prime w-28 shrink-0 px-0" aria-label="Join party">
              Join
            </button>
          </div>
          <p id="code-hint" className="mt-2 flex items-center gap-1.5 text-small text-ink-muted">
            {tried && !ready ? (
              <span className="flex items-center gap-1.5 text-hot-600">
                <Icon name="warn" size={16} /> Party codes are at least 3 letters.
              </span>
            ) : (
              <>
                <Icon name="nfc" size={16} /> Or tap your phone on the box.
              </>
            )}
          </p>
        </form>

        <p className="mt-7 text-center text-cap text-ink-muted">Test money and points only. No real-money betting.</p>
      </div>
    </div>
  );
}

/** The join code as letter tiles: white tiles, ink letters, popping in one after another. */
export function CodeTiles({ code, small = false, delay = 0 }: { code: string; small?: boolean; delay?: number }) {
  return (
    <span className="flex shrink-0 gap-1" aria-label={`Code ${code.split('').join(' ')}`} role="img" translate="no">
      {code.split('').map((ch, i) => (
        <span
          key={i}
          className={`num hd-pop grid place-items-center rounded-chip bg-card text-ink shadow-lift ring-1 ring-inset ring-rule ${small ? 'h-8 w-7 text-lead' : 'h-12 w-10 text-head'}`}
          style={d(delay + i * 90)}
          aria-hidden="true"
        >
          {ch}
        </span>
      ))}
    </span>
  );
}
