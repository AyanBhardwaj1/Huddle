import type { ChainEvent, Party, PlayerPublic } from '@huddle/shared';
import { Roll } from '@huddle/ui';
import { motion } from 'framer-motion';
import { useRef, type CSSProperties } from 'react';
import { CaptionBar } from '../components/board';
import { BoxButtons } from '../components/controls';
import { Icon, Wordmark } from '../components/ui';
import { formatSecs, isPoints, leaderboard, moneyShort, settlementSteps } from '../lib/derive';
import { useNow, useParty } from '../party';
import { useBox } from '../store';
import { ScorecardPanel } from './Scorecard';

const PODIUM_ORDER = [1, 0, 2]; // 2nd, 1st, 3rd
const PODIUM_H = ['h-[6.5rem]', 'h-[4.5rem]', 'h-[3.25rem]'];

const CHAIN_LABEL: Record<ChainEvent['kind'], string> = {
  create_party: 'Party opened',
  deposit: 'Buy-in',
  request_close: 'Party closed',
  submit_state: 'Balance submitted',
  finalize: 'Settled',
  withdraw: 'Payout landed',
};

function pnlTone(pnl: number) {
  return pnl > 0 ? 'text-yes' : pnl < 0 ? 'text-no' : 'text-night-200';
}

function Pnl({ pnl, party, className }: { pnl: number; party: Party; className: string }) {
  return (
    <span className={`num flex items-center gap-1 whitespace-nowrap leading-none ${pnlTone(pnl)} ${className}`}>
      {pnl !== 0 && <Icon name={pnl > 0 ? 'up' : 'down'} className="h-[0.45em] w-[0.45em]" />}
      {moneyShort(pnl, party, { sign: true })}
    </span>
  );
}

function Podium({ ranked, party }: { ranked: PlayerPublic[]; party: Party }) {
  return (
    <div className="flex items-end justify-center gap-3" aria-label="Podium">
      {PODIUM_ORDER.map((idx) => {
        const p = ranked[idx];
        if (!p) return <div key={idx} className="w-[10rem]" aria-hidden="true" />;
        const first = idx === 0;
        return (
          <div key={p.pubkey} className="hd-rise flex w-[10rem] min-w-0 flex-col items-center" style={{ ['--d' as string]: `${(2 - idx) * 220}ms` } as CSSProperties}>
            {first && <Icon name="crown" className="mb-1 h-7 w-7 text-flood" title="Winner" />}
            <span
              className={`max-w-full truncate px-1 font-bold leading-tight ${first && p.name.length <= 8 ? 'hd-shine text-head' : first ? 'hd-shine text-title' : 'text-lead'}`}
              style={{ ['--d' as string]: '900ms' } as CSSProperties}
            >
              {p.name}
            </span>
            <Pnl pnl={p.pnl} party={party} className={first ? (moneyShort(p.pnl, party, { sign: true }).length > 7 ? 'text-head' : 'text-display') : 'text-title'} />
            <div
              className={`mt-2 flex w-full items-start justify-center rounded-t-tile pt-1.5 ${PODIUM_H[idx]} ${first ? 'bg-flood text-flood-ink' : 'bg-night-800 text-night-200'}`}
            >
              <span className="num text-head leading-none">{idx + 1}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function EndGame() {
  const { view } = useParty();
  const setSession = useBox((s) => s.setSession);
  const setScreen = useBox((s) => s.setScreen);
  const now = useNow(500);
  const s = view.snapshot!;
  const party = s.party;
  const ranked = leaderboard(s.players);
  const steps = settlementSteps(party);
  const challengeLeft =
    party.status === 'closing' && party.chain.challengeEndsAt ? Math.max(0, Date.parse(party.chain.challengeEndsAt) - now) : null;
  const points = isPoints(party);
  const pot = ranked.reduce((a, p) => a + p.deposited, 0);
  const withdrawals = new Map(view.chainEvents.filter((e) => e.kind === 'withdraw' && e.member).map((e) => [e.member!, e]));
  // Rows already paid on first paint don't replay the coin.
  const seenPaid = useRef<Set<string> | null>(null);
  if (seenPaid.current === null) seenPaid.current = new Set(withdrawals.keys());

  return (
    <div className="flex h-full flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
        {/* Standings */}
        <section className="flex min-h-0 flex-col px-7 pb-4 pt-5" aria-label="Final standings" data-testid="final-leaderboard">
          <div className="flex items-center gap-4">
            <Wordmark className="text-lead text-night-400" lit={12} />
            <span className="num ml-auto whitespace-nowrap text-title">
              {s.game.home.short} {s.game.score.home}
              <span className="px-1.5 text-night-400">–</span>
              {s.game.score.away} {s.game.away.short}
            </span>
          </div>
          <h1 className="q mt-3 text-title leading-tight">Full time. Here’s how the room did.</h1>
          <div className="mt-auto pt-3">
            <Podium ranked={ranked} party={party} />
          </div>
          <ol className="flex flex-col border-t border-night-700" start={4} aria-label="Rest of the leaderboard">
            {ranked.slice(3, 5).map((p, i) => (
              <motion.li layout="position" key={p.pubkey} className="flex items-baseline gap-3 border-b border-night-700 py-1.5">
                <span className="num w-6 text-lead text-night-400">{i + 4}</span>
                <span className="min-w-0 flex-1 truncate text-lead font-semibold">{p.name}</span>
                <Pnl pnl={p.pnl} party={party} className="text-title" />
              </motion.li>
            ))}
          </ol>
          <div className="mt-3 flex items-center gap-4">
            <button
              type="button"
              className="btn-primary min-h-[3.25rem] px-7"
              onClick={() => {
                setSession(null);
                setScreen('create');
              }}
            >
              New party <Icon name="arrowRight" className="h-5 w-5" strokeWidth={2.6} />
            </button>
            <p className="min-w-0 text-body text-night-400">Same box, next game.</p>
          </div>
        </section>

        {/* Settling up + scorecard */}
        <section className="flex min-h-0 flex-col gap-2.5 overflow-hidden border-l border-night-700 bg-night-900 px-6 pb-4 pt-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-title font-bold">{points ? 'Locking the scores' : 'Settling up'}</h2>
            {!points && (
              <span className="ml-auto text-body text-night-400">
                Pot <span className="num text-lead text-chalk">{moneyShort(pot, party)}</span>
              </span>
            )}
            <BoxButtons canLock={false} showLock={false} compact />
          </div>
          <ol className="flex items-start" aria-label="Settlement progress">
            {steps.map((st, i) => (
              <li key={st.id} className="flex flex-1 flex-col items-start gap-1" aria-current={st.state === 'active' ? 'step' : undefined}>
                <span className="flex w-full items-center">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-body font-bold ${
                      st.state === 'done' ? 'bg-flood text-flood-ink' : st.state === 'active' ? 'bg-chalk text-night-950' : 'bg-night-800 text-night-400'
                    }`}
                  >
                    {st.state === 'done' ? <Icon name="check" className="h-4 w-4" strokeWidth={3} /> : i + 1}
                  </span>
                  {i < steps.length - 1 && <span className={`mx-2 h-[2px] flex-1 ${st.state === 'done' ? 'bg-flood' : 'bg-night-700'}`} aria-hidden="true" />}
                </span>
                <span className={`pr-2 text-small font-semibold leading-tight ${st.state === 'todo' ? 'text-night-400' : ''}`}>
                  {st.label}
                  {st.id === 'closing' && challengeLeft !== null && <span className="num ml-1.5 text-lead text-chalk">{formatSecs(challengeLeft)}</span>}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-small text-night-400">
            {points
              ? 'Points party: final scores are locked in, nothing to pay out.'
              : party.status === 'finalized'
                ? 'Everyone has been paid out automatically.'
                : 'Balances are co-signed, so payouts land automatically when the window closes.'}
          </p>
          {(
            <div>
              <ul className="flex flex-col" aria-label={points ? "Final scores" : "Payouts"} aria-live="polite">
                {ranked.slice(0, points ? 5 : 3).map((p) => {
                  const w = withdrawals.get(p.pubkey);
                  const fresh = !!w && !seenPaid.current!.has(p.pubkey);
                  return (
                    <li key={p.pubkey} className="relative flex items-baseline gap-3 border-t border-night-700 py-1">
                      <span className="min-w-0 flex-1 truncate text-lead">{p.name}</span>
                      <span className={`text-small ${w || points ? 'text-flood' : 'text-night-400'}`}>{points ? 'Final' : w ? CHAIN_LABEL.withdraw : 'Waiting'}</span>
                      {w?.explorerUrl && (
                        <a
                          href={w.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-small font-semibold text-night-200 underline decoration-night-600 underline-offset-4 hover:text-chalk"
                        >
                          receipt
                        </a>
                      )}
                      <span className={`num text-title ${w || points ? 'text-chalk' : 'text-night-400'}`}>
                        <Roll text={moneyShort(p.payout ?? p.balance, party)} value={p.payout ?? p.balance} />
                      </span>
                      {fresh && (
                        <span className="hd-coin left-0 top-1/2" style={{ ['--dx' as string]: '20rem', ['--dy' as string]: '0' } as CSSProperties} aria-hidden="true" />
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className={`border-t border-night-700 pt-3 ${points ? '' : 'mt-auto'}`}>
            <ScorecardPanel scorecard={s.scorecard} compact />
          </div>
        </section>
      </div>
      <CaptionBar lines={s.announcer} />
    </div>
  );
}
