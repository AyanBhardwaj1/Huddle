import type { ChainEvent, Party } from '@huddle/shared';
import { Icon, Mark, Roll } from '@huddle/ui';
import { useEffect, useRef } from 'react';
import { cx, useParty } from '../components/ctx';
import { Money, useCoins } from '../components/primitives';
import { Leaderboard } from '../components/Tabs';
import { ordinal, rankPlayers } from '../lib/markets';
import { money, pnl } from '../lib/money';

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
    const t = setTimeout(() => fire(pot.current, amount.current, 8), 250);
    return () => clearTimeout(t);
    // Once per landing (keyed on `finalized`), not on every balance tick.
  }, [finalized]);

  return (
    <div className="space-y-8">
      <section className="rounded-panel bg-night-900 px-5 pb-6 pt-5 text-center" aria-labelledby="ft-title">
        <p id="ft-title" className="text-small text-night-400">
          Full time
        </p>
        <p className="mt-1 font-display text-head font-extrabold uppercase stretch-condensed tnum" aria-label={`${g.home.name} ${g.score.home}, ${g.away.name} ${g.score.away}`}>
          {g.home.short} {g.score.home}
          <span className="mx-2 text-night-500">–</span>
          {g.score.away} {g.away.short}
        </p>
        <div className="mx-auto my-5 h-px w-16 bg-night-700" />
        <div
          className={cx(
            'inline-flex max-w-full items-center gap-1 font-display font-black stretch-condensed',
            // "+$4.20" fits the hero size at 360 px; "+12.50 pts" steps down a size.
            pnl(profit, points).length > 7 ? 'text-display' : 'text-hero',
            profit > 0 ? 'hd-shine text-yes' : profit < 0 ? 'text-no' : 'text-chalk',
          )}
          style={{ ['--d' as string]: '400ms' }}
        >
          {profit !== 0 && <Icon name={profit > 0 ? 'up' : 'down'} size="0.3em" />}
          <Money value={profit} points={points} signed flash={false} />
        </div>
        <p className="mt-2 text-lead font-semibold text-chalk">{verdict}</p>
        {rank > 0 && (
          <p className="text-small text-night-400">
            You finished {ordinal(rank)} of {ranked.length}
          </p>
        )}
      </section>

      <section aria-labelledby="settle-title">
        <h2 id="settle-title" className="mb-3 font-display text-lead font-bold stretch-semi">
          {finalized ? (points ? 'Final points' : 'Paid out') : 'Settling up'}
        </h2>
        <div className="rounded-panel bg-night-900 p-5">
          <ol className="relative grid grid-cols-3" aria-label="Settlement">
            <span className="absolute left-[16.67%] right-[16.67%] top-[0.9rem] h-0.5 bg-night-700" aria-hidden="true" />
            <span
              className="pl-rail absolute left-[16.67%] right-[16.67%] top-[0.9rem] h-0.5 bg-flood"
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
                      'grid h-7 w-7 place-items-center rounded-full',
                      done ? 'bg-flood text-flood-ink' : current ? 'bg-night-900 text-flood' : 'bg-night-800 text-night-500',
                    )}
                  >
                    {done ? <Icon name="check" size={16} strokeWidth={2.8} /> : current ? <Mark size="1.75rem" spin /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                  </span>
                  <span className={cx('text-cap font-semibold', done || current ? 'text-chalk' : 'text-night-400')}>{s.label}</span>
                </li>
              );
            })}
          </ol>

          {!finalized && (
            <p className="mt-5 text-pretty text-center text-small text-night-200">
              {status === 'closing'
                ? `Everyone's final balance is being checked.${points ? '' : ' Your winnings land automatically in about a minute.'}`
                : 'Settling the last questions…'}
            </p>
          )}

          {finalized && payout != null && (
            <div className="mt-6 rounded-tile bg-night-850 px-4 py-5 text-center">
              <p className="text-small font-semibold text-night-200">{points ? 'Your final points' : 'Your winnings are in'}</p>
              <div ref={amount} className="hd-stamp mt-1 inline-block" style={{ ['--d' as string]: '150ms' }}>
                <span
                  className={cx('block font-display text-display font-black stretch-condensed', profit > 0 && 'hd-shine')}
                  data-testid="my-payout"
                  data-amount={payout}
                  style={{ ['--d' as string]: '600ms' }}
                >
                  <Roll text={money(payout, points)} className="tnum" flash={false} />
                </span>
              </div>
              {link && (
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-quiet mx-auto mt-2 flex w-fit text-small underline-offset-4 hover:underline"
                >
                  View payout <Icon name="external" size={15} />
                </a>
              )}
            </div>
          )}
          {!points && <p className="mt-4 text-center text-cap text-night-400">Settled on Solana · devnet test money</p>}
        </div>
      </section>

      <div data-testid="final-leaderboard">
        <Leaderboard title="Final leaderboard" />
      </div>
      {snap.scorecard.verdict && (
        <section aria-labelledby="verdict-title">
          <h2 id="verdict-title" className="mb-2 text-small text-night-400">
            Friends vs. Model vs. Gemini
          </h2>
          <p className="text-balance font-display text-title font-bold stretch-semi">{snap.scorecard.verdict}</p>
        </section>
      )}
      {coins}
    </div>
  );
}
