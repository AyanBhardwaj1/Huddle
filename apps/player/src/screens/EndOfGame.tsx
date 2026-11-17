import type { ChainEvent, Party } from '@huddle/shared';
import { motion } from 'framer-motion';
import { cx, useParty } from '../components/ctx';
import { Icon } from '../components/Icon';
import { Confetti, Ticker } from '../components/primitives';
import { Leaderboard } from '../components/Tabs';
import { rankPlayers } from '../lib/markets';
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

/** Final whistle: your result, settlement progress, payout, final leaderboard (PRD Flow F). */
export function EndOfGame() {
  const { snap, view, me, meP, points } = useParty();
  const status = snap.party.status;
  const stepIdx = STEPS.findIndex((s) => s.status === status);
  const finalized = status === 'finalized';
  const profit = meP?.pnl ?? 0;
  const rank = rankPlayers(snap.players).findIndex((p) => p.pubkey === me) + 1;
  const payout = meP?.payout ?? (finalized ? (meP?.balance ?? 0) + (meP?.locked ?? 0) : undefined);
  const link = points ? null : explorerLink(snap.party, view.chainEvents, me, meP?.withdrawTx);
  const g = snap.game;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-card border border-pitch-700 bg-gradient-to-b from-pitch-800 to-pitch-900 p-5 text-center">
        {finalized && profit > 0 && <Confetti />}
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-pitch-400">Full time</div>
        <div className="mt-1 font-display text-4xl font-bold uppercase tnum">
          {g.home.short} {g.score.home} – {g.score.away} {g.away.short}
        </div>
        <div className="mt-5 text-sm text-pitch-200">{rank ? `You finished #${rank}` : 'Your night'}</div>
        <div className={cx('font-display text-6xl font-bold leading-none tnum', profit > 0 ? 'text-up' : profit < 0 ? 'text-down' : 'text-pitch-50')}>
          <Ticker value={profit} format={(v) => pnl(Math.round(v), points)} flash={false} />
        </div>
      </section>

      <section className="rounded-card border border-pitch-700 bg-pitch-900 p-4">
        <ol className="flex items-center gap-2">
          {STEPS.map((s, i) => {
            const done = i <= stepIdx;
            return (
              <li key={s.status} className="flex flex-1 flex-col items-center gap-1.5 text-center">
                <motion.span
                  initial={false}
                  animate={{ scale: i === stepIdx ? [1, 1.15, 1] : 1 }}
                  transition={{ repeat: i === stepIdx && !finalized ? Infinity : 0, duration: 1.4 }}
                  className={cx('grid h-9 w-9 place-items-center rounded-full', done ? 'bg-volt text-volt-ink' : 'bg-pitch-700 text-pitch-400')}
                >
                  {i < stepIdx || finalized ? <Icon name="check" size={18} /> : <span className="font-display font-bold">{i + 1}</span>}
                </motion.span>
                <span className={cx('text-xs font-semibold', done ? 'text-pitch-50' : 'text-pitch-400')}>{s.label}</span>
              </li>
            );
          })}
        </ol>
        {!finalized && (
          <p className="mt-4 text-center text-sm text-pitch-400">
            {status === 'closing'
              ? `Everyone's final balance is being checked. ${points ? '' : 'Payouts land automatically in about a minute.'}`
              : 'Settling the last questions…'}
          </p>
        )}
        {finalized && payout != null && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-5 rounded-2xl bg-volt/10 p-4 text-center">
            <div className="text-sm font-semibold text-volt">{points ? 'Final points' : 'Your winnings are in'}</div>
            <div className="font-display text-5xl font-bold tnum" data-testid="my-payout" data-amount={payout}>
              {money(payout, points)}
            </div>
            {link && (
              <a href={link} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-pitch-200 underline-offset-4 active:underline">
                View payout <Icon name="external" size={14} />
              </a>
            )}
          </motion.div>
        )}
        {!points && <p className="mt-3 text-center text-[11px] text-pitch-400">Settled on Solana · devnet test money</p>}
      </section>

      <div data-testid="final-leaderboard">
        <Leaderboard title="Final leaderboard" />
      </div>
      {snap.scorecard.verdict && (
        <section className="rounded-card border border-pitch-700 bg-pitch-900 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-pitch-400">Friends vs. Model vs. Gemini</div>
          <p className="mt-1 font-display text-xl font-semibold leading-snug">{snap.scorecard.verdict}</p>
        </section>
      )}
    </div>
  );
}
