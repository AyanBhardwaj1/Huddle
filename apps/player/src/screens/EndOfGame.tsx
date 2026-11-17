import type { ChainEvent, Party, PlayerPublic } from '@huddle/shared';
import { Burst, Icon, Kinetic, Mark, Roll } from '@huddle/ui';
import { useEffect, useRef } from 'react';
import { cx, useParty } from '../components/ctx';
import { Avatar, Money, useCoins } from '../components/primitives';
import { Leaderboard } from '../components/Tabs';
import { ordinal, rankPlayers } from '../lib/markets';
import { money, pnl } from '../lib/money';

const dl = (ms: number) => ({ ['--d' as string]: `${ms}ms` });

const STEPS = [
  { status: 'ended', label: 'Final whistle' },
  { status: 'closing', label: 'Closing the pot' },
  { status: 'finalized', label: 'Paid out' },
] as const;

export function explorerLink(party: Party, events: ChainEvent[], me: string, withdrawTx?: string): string | null {
  const mine = [...events].reverse().find((e) => (e.kind === 'withdraw' || e.kind === 'finalize') && (!e.member || e.member === me) && e.explorerUrl);
  if (mine?.explorerUrl) return mine.explorerUrl;
  const sig = withdrawTx ?? party.chain.finalizeTx;
  const base = party.chain.explorerBase;
  if (!sig || !base) return null;
  const [path, query] = base.split('?');
  return `${path!.replace(/\/$/, '')}/tx/${sig}${query ? `?${query}` : '?cluster=devnet'}`;
}

/** Final whistle: your night in one number, the pot closing, the payout landing, the board (Flow F). */
export function EndOfGame() {
  const { snap, view, me, meP, points } = useParty();
  const status = snap.party.status;
  const stepIdx = Math.max(0, STEPS.findIndex((s) => s.status === status));
  const finalized = status === 'finalized';
  const profit = meP?.pnl ?? 0;
  const ranked = rankPlayers(snap.players);
  const rank = ranked.findIndex((p) => p.pubkey === me) + 1;
  const payout = meP?.payout ?? (finalized ? (meP?.balance ?? 0) + (meP?.locked ?? 0) : undefined);
  const link = points ? null : explorerLink(snap.party, view.chainEvents, me, meP?.withdrawTx);
  const g = snap.game;
  const verdict =
    rank === 1 && profit > 0 ? 'You won the room.' : profit > 0 ? 'Up on the night.' : profit < 0 ? 'Cooked tonight.' : 'Broke even.';

  // money-flow: when the payout lands, coins travel from the pot to your number.
  const pot = useRef<HTMLSpanElement>(null);
  const amount = useRef<HTMLDivElement>(null);
  const [coins, fire] = useCoins();
  useEffect(() => {
    if (!finalized || payout == null) return;
    const t = setTimeout(() => fire(pot.current, amount.current, 5), 250);
    return () => clearTimeout(t);
    // Once per landing (keyed on `finalized`), not on every balance tick.
  }, [finalized]);

  return (
    <div className="space-y-8">
      <section className="card relative overflow-visible px-5 pb-6 pt-5 text-center" aria-labelledby="ft-title">
        <div className="absolute inset-x-0 top-0 h-1 overflow-hidden rounded-t-panel" aria-hidden="true">
          <div className="h-full bg-prime" />
        </div>
        <p id="ft-title" className="text-small font-semibold text-ink-muted">
          Full time
        </p>
        <p className="mt-2 flex items-center justify-center gap-2" aria-label={`${g.home.name} ${g.score.home}, ${g.away.name} ${g.score.away}`}>
          <span className="font-head text-title font-extrabold uppercase" aria-hidden="true">
            {g.home.short}
          </span>
          <span className="num hd-pop grid h-11 min-w-[2.5rem] place-items-center rounded-chip bg-ink px-1.5 text-head text-white" aria-hidden="true">
            {g.score.home}
          </span>
          <span className="num hd-pop grid h-11 min-w-[2.5rem] place-items-center rounded-chip bg-ink px-1.5 text-head text-white" style={dl(90)} aria-hidden="true">
            {g.score.away}
          </span>
          <span className="font-head text-title font-extrabold uppercase" aria-hidden="true">
            {g.away.short}
          </span>
        </p>
        <div className="mx-auto my-5 h-px w-16 bg-rule" />
        <div
          className={cx(
            'num hd-zoom inline-flex max-w-full items-center gap-1 leading-[0.9]',
            // "+$4.20" fits the hero size at 360 px; "+12.50 pts" steps down a size.
            pnl(profit, points).length > 7 ? 'text-display' : 'text-hero',
            profit > 0 ? 'hd-shine text-yes-600' : profit < 0 ? 'text-no-600' : 'text-ink',
          )}
          style={dl(300)}
        >
          {profit !== 0 && <Icon name={profit > 0 ? 'up' : 'down'} size="0.3em" />}
          <Money value={profit} points={points} signed flash={false} duration={1200} />
        </div>
        <Kinetic as="p" text={verdict} className="q mt-3 block text-title" delay={500} stagger={60} />
        {rank > 0 && (
          <p className="hd-rise text-small text-ink-muted" style={dl(800)}>
            You finished {ordinal(rank)} of {ranked.length}
          </p>
        )}
        {rank === 1 && profit > 0 ? (
          <Burst count={40} seed={11} y="45%" spread={16} delay={600} />
        ) : profit > 0 ? (
          <Burst count={14} seed={5} y="45%" spread={10} delay={600} />
        ) : null}
      </section>

      <section aria-labelledby="settle-title">
        <Kinetic as="h2" id="settle-title" text={finalized ? (points ? 'Final points' : 'Paid out') : 'Settling up'} className="q mb-3 block text-lead" />
        <div className="card p-5">
          <ol className="relative grid grid-cols-3" aria-label="Settlement">
            <span className="absolute left-[16.67%] right-[16.67%] top-[0.95rem] h-1 rounded-full bg-well" aria-hidden="true" />
            <span
              className="pl-rail absolute left-[16.67%] right-[16.67%] top-[0.95rem] h-1 rounded-full bg-prime"
              style={{ transform: `scaleX(${stepIdx / 2})` }}
              aria-hidden="true"
            />
            {STEPS.map((s, i) => {
              const done = i < stepIdx || finalized;
              const current = i === stepIdx && !finalized;
              return (
                <li key={s.status} className="relative flex flex-col items-center gap-2 text-center" aria-current={current ? 'step' : undefined}>
                  <span
                    ref={i === 2 ? pot : undefined}
                    className={cx(
                      'grid h-8 w-8 place-items-center rounded-full',
                      done ? cx('hd-pop shadow-zap', i === 2 ? 'bg-gold text-gold-on shadow-gold' : 'bg-zap text-zap-ink') : current ? 'bg-card text-zap shadow-lift' : 'bg-well text-ink-faint',
                    )}
                    style={dl(i * 120)}
                  >
                    {done ? <Icon name="check" size={17} strokeWidth={2.8} /> : current ? <Mark size="1.9rem" spin lit={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                  </span>
                  <span className={cx('text-cap font-bold', done || current ? 'text-ink' : 'text-ink-muted')}>{s.label}</span>
                </li>
              );
            })}
          </ol>

          {!finalized && (
            <p className="mt-5 text-pretty text-center text-small text-ink-2">
              {status === 'closing'
                ? `Everyone's final balance is being checked.${points ? '' : ' Your winnings land automatically in about a minute.'}`
                : 'Settling the last questions…'}
            </p>
          )}

          {finalized && payout != null && (
            <div className="hd-rise mt-6 rounded-tile bg-gold-50 px-4 py-5 text-center ring-1 ring-inset ring-gold-100">
              <p className="text-small font-bold text-gold-600">{points ? 'Your final points' : 'Your winnings are in'}</p>
              <div ref={amount} className="hd-stamp mt-1 inline-block" style={dl(150)}>
                <span
                  className={cx('num block text-display text-ink', profit > 0 && 'hd-shine')}
                  data-testid="my-payout"
                  data-amount={payout}
                  style={dl(600)}
                >
                  <Roll text={money(payout, points)} flash={false} duration={1200} />
                </span>
              </div>
              {link && (
                <a href={link} target="_blank" rel="noreferrer" className="btn-quiet mx-auto mt-2 flex w-fit text-small underline-offset-4 hover:underline">
                  View payout <Icon name="external" size={15} />
                </a>
              )}
            </div>
          )}
          {!points && <p className="mt-4 text-center text-cap text-ink-muted">Settled on Solana · devnet test money</p>}
        </div>
      </section>

      {ranked.length > 0 && (
        <section aria-label="Podium">
          <Podium ranked={ranked} points={points} me={me} />
        </section>
      )}

      <div data-testid="final-leaderboard">
        <Leaderboard title="Final leaderboard" />
      </div>
      {snap.scorecard.verdict && (
        <section aria-labelledby="verdict-title" className="rounded-panel bg-prime-soft p-5">
          <h2 id="verdict-title" className="text-small font-bold text-zap-deep">
            Friends vs. Model vs. Gemini
          </h2>
          <Kinetic as="p" text={snap.scorecard.verdict} className="q mt-1 block text-title" stagger={40} />
        </section>
      )}
      {coins}
    </div>
  );
}

const PODIUM_ORDER = [1, 0, 2]; // 2nd, 1st, 3rd
const PODIUM_H = ['h-24', 'h-16', 'h-11'];
const PODIUM_FILL = ['bg-prime text-white shadow-zap', 'bg-ink text-white shadow-pop', 'bg-card text-ink shadow-lift ring-1 ring-inset ring-rule'];

/** The podium as the box draws it: prime 1st, ink 2nd, white 3rd; blocks rise, names pop. */
function Podium({ ranked, points, me }: { ranked: PlayerPublic[]; points: boolean; me: string }) {
  return (
    <div className="flex items-end justify-center gap-2">
      {PODIUM_ORDER.map((idx) => {
        const p = ranked[idx];
        if (!p) return <div key={idx} className="flex-1" aria-hidden="true" />;
        const first = idx === 0;
        const at = (2 - idx) * 220;
        return (
          <div key={p.pubkey} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="hd-pop flex min-w-0 max-w-full flex-col items-center" style={dl(at + 180)}>
              {first && (
                <span className="hd-float mb-1 grid h-7 w-7 place-items-center rounded-full bg-gold text-gold-on shadow-gold">
                  <Icon name="crown" size={16} title="Winner" />
                </span>
              )}
              <Avatar name={p.name} size={first ? '2.75rem' : '2.25rem'} />
              <span className={cx('mt-1 max-w-full truncate px-1 font-head font-extrabold leading-tight', first ? 'text-lead' : 'text-body')}>
                {p.pubkey === me ? 'You' : p.name}
              </span>
              <span className={cx('num flex items-center gap-0.5 text-body', p.pnl > 0 ? 'text-yes-600' : p.pnl < 0 ? 'text-no-600' : 'text-ink-2')}>
                {p.pnl !== 0 && <Icon name={p.pnl > 0 ? 'up' : 'down'} size={10} />}
                <Roll text={pnl(p.pnl, points)} value={p.pnl} flash={false} duration={1000} />
              </span>
            </div>
            <div className="mt-2 w-full overflow-hidden rounded-t-panel">
              <div className={cx('hd-rise flex w-full items-start justify-center pt-1.5', PODIUM_H[idx], PODIUM_FILL[idx])} style={dl(at)}>
                <span className="num text-title leading-none">{idx + 1}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
