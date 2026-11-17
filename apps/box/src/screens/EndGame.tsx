import type { ChainEvent, Party, PlayerPublic } from '@huddle/shared';
import { Aurora, Avatar, Burst, Kinetic, Roll } from '@huddle/ui';
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
const PODIUM_H = ['h-[5rem]', 'h-[3.5rem]', 'h-[2.5rem]'];
const PODIUM_FILL = ['bg-prime text-white shadow-zap', 'bg-ink text-white shadow-pop', 'bg-card text-ink shadow-lift ring-1 ring-inset ring-rule'];
const d = (ms: number) => ({ ['--d' as string]: `${ms}ms` }) as CSSProperties;

const CHAIN_LABEL: Record<ChainEvent['kind'], string> = {
  create_party: 'Party opened',
  deposit: 'Buy-in',
  request_close: 'Party closed',
  submit_state: 'Balance submitted',
  finalize: 'Settled',
  withdraw: 'Payout landed',
};

function pnlTone(pnl: number) {
  return pnl > 0 ? 'text-yes-600' : pnl < 0 ? 'text-no-600' : 'text-ink-2';
}

function Pnl({ pnl, party, className }: { pnl: number; party: Party; className: string }) {
  return (
    <span className={`num flex items-center gap-1 whitespace-nowrap leading-none ${pnlTone(pnl)} ${className}`}>
      {pnl !== 0 && <Icon name={pnl > 0 ? 'up' : 'down'} className="h-[0.45em] w-[0.45em]" />}
      <Roll text={moneyShort(pnl, party, { sign: true })} value={pnl} flash={false} duration={1100} />
    </span>
  );
}

function Podium({ ranked, party }: { ranked: PlayerPublic[]; party: Party }) {
  return (
    <div className="relative flex items-end justify-center gap-3" aria-label="Podium">
      {ranked[0] && <Burst seed={7} count={36} x="50%" y="30%" spread={16} delay={1100} />}
      {PODIUM_ORDER.map((idx) => {
        const p = ranked[idx];
        if (!p) return <div key={idx} className="w-[10rem]" aria-hidden="true" />;
        const first = idx === 0;
        const at = (2 - idx) * 260;
        return (
          <div key={p.pubkey} className="flex w-[10rem] min-w-0 flex-col items-center">
            <div className="hd-pop flex flex-col items-center" style={d(at + 200)}>
              {first && (
                <span className="hd-float mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-gold text-gold-on shadow-gold">
                  <Icon name="crown" className="h-5 w-5" title="Winner" />
                </span>
              )}
              <Avatar name={p.name} size={first ? '2.75rem' : '2.25rem'} />
              <span
                className={`mt-1 max-w-full truncate px-1 font-head font-extrabold leading-tight ${first ? 'hd-shine text-title' : 'text-lead'}`}
                style={d(at + 900)}
              >
                {p.name}
              </span>
              <Pnl pnl={p.pnl} party={party} className={first ? (moneyShort(p.pnl, party, { sign: true }).length > 7 ? 'text-title' : 'text-head') : 'text-lead'} />
            </div>
            <div className="mt-2 w-full overflow-hidden rounded-t-panel">
              <div className={`hd-rise flex w-full items-start justify-center pt-1.5 ${PODIUM_H[idx]} ${PODIUM_FILL[idx]}`} style={d(at)}>
                <span className="num text-title leading-none">{idx + 1}</span>
              </div>
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
    <div className="relative flex h-full flex-col bg-canvas">
      <Aurora
        blobs={[
          { c: 'rgba(255,176,32,0.22)', x: '5vw', y: '-25vmax', s: '60vmax', mx: '6vmax', my: '6vmax', dur: '24s' },
          { c: 'rgba(108,43,255,0.18)', x: '-15vmax', y: '35vh', s: '55vmax', mx: '8vmax', my: '-5vmax', dur: '28s', d: '-6s' },
        ]}
      />
      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-3 px-3 pt-3">
        {/* Standings */}
        <section className="flex min-h-0 flex-col px-4 pb-2 pt-2" aria-label="Final standings" data-testid="final-leaderboard">
          <div className="flex items-center gap-4">
            <Wordmark className="text-lead" lit={12} />
            <span className="hd-drop num ml-auto flex items-center gap-1.5 whitespace-nowrap rounded-full bg-card px-3 py-1 text-title shadow-lift">
              {s.game.home.short} {s.game.score.home}
              <span className="text-ink-muted">–</span>
              {s.game.score.away} {s.game.away.short}
            </span>
          </div>
          <h1 className="q mt-2 text-title leading-[1.05]">
            <Kinetic text="Full time. Here’s how the room did." delay={100} />
          </h1>
          <div className="mt-auto pt-3">
            <Podium ranked={ranked} party={party} />
          </div>
          <ol className="grid grid-cols-2 gap-1.5 pt-2" start={4} aria-label="Rest of the leaderboard">
            {ranked.slice(3, 5).map((p, i) => (
              <motion.li
                layout="position"
                key={p.pubkey}
                className="hd-rise flex items-center gap-3 rounded-tile bg-card px-3 py-1.5 shadow-lift"
                style={d(1000 + i * 90)}
              >
                <span className="num w-6 text-lead text-ink-muted">{i + 4}</span>
                <Avatar name={p.name} size="1.75rem" />
                <span className="min-w-0 flex-1 truncate text-body font-bold">{p.name}</span>
                <Pnl pnl={p.pnl} party={party} className="text-lead" />
              </motion.li>
            ))}
          </ol>
          <div className="mt-2.5 flex items-center gap-4">
            <button
              type="button"
              className="btn-prime min-h-[3.25rem] px-7"
              onClick={() => {
                setSession(null);
                setScreen('create');
              }}
            >
              New party <Icon name="arrowRight" className="h-5 w-5" strokeWidth={2.6} />
            </button>
            <p className="min-w-0 text-body text-ink-2">Same box, next game.</p>
          </div>
        </section>

        {/* Settling up + scorecard */}
        <section className="hd-slide-r card flex min-h-0 flex-col gap-2 overflow-hidden rounded-blob px-5 pb-3 pt-3.5 shadow-pop" style={d(150)}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-head text-title font-extrabold">{points ? 'Locking the scores' : 'Settling up'}</h2>
            {!points && (
              <span className="ml-auto flex items-center gap-1.5 text-body text-ink-2">
                <span className="h-3 w-3 rounded-full bg-gold" aria-hidden="true" /> Pot <span className="num text-lead text-ink">{moneyShort(pot, party)}</span>
              </span>
            )}
            <BoxButtons canLock={false} showLock={false} compact />
          </div>
          <ol className="flex items-start" aria-label="Settlement progress">
            {steps.map((st, i) => {
              // The active challenge step carries its own live countdown in the badge.
              const timer = st.id === 'closing' && st.state === 'active' && challengeLeft !== null;
              return (
              <li key={st.id} className="flex flex-1 flex-col items-start gap-1" aria-current={st.state === 'active' ? 'step' : undefined}>
                <span className="flex w-full items-center">
                  <span
                    className={`relative flex h-8 shrink-0 items-center justify-center rounded-full font-num text-body font-bold ${timer ? 'min-w-[3.25rem] px-2' : 'w-8'} ${
                      st.state === 'done' ? 'bg-zap text-white shadow-zap' : st.state === 'active' ? 'bg-ink text-white' : 'bg-well text-ink-muted'
                    }`}
                  >
                    <span className="relative">
                      {st.state === 'done' ? (
                        <Icon name="check" className="hd-pop h-4 w-4" strokeWidth={3} />
                      ) : timer ? (
                        <Roll text={formatSecs(challengeLeft)} label={`${formatSecs(challengeLeft)} seconds left`} flash={false} duration={320} />
                      ) : (
                        i + 1
                      )}
                    </span>
                  </span>
                  {i < steps.length - 1 && (
                    <span className="mx-2 h-1 flex-1 overflow-hidden rounded-full bg-well" aria-hidden="true">
                      {st.state === 'done' && <span className="hd-flood block h-full w-full bg-zap" style={d(300 + i * 200)} />}
                    </span>
                  )}
                </span>
                <span className={`pr-2 text-small font-semibold leading-tight ${st.state === 'todo' ? 'text-ink-muted' : ''}`}>
                  {st.label}
                </span>
              </li>
              );
            })}
          </ol>
          <p className="shrink-0 text-small text-ink-2">
            {points
              ? 'Points party: final scores are locked in, nothing to pay out.'
              : party.status === 'finalized'
                ? 'Everyone has been paid out automatically.'
                : 'Balances are co-signed, so payouts land automatically when the window closes.'}
          </p>
          <ul className="flex flex-col gap-1" aria-label={points ? 'Final scores' : 'Payouts'} aria-live="polite">
            {ranked.slice(0, points ? 5 : 3).map((p, i) => {
              const w = withdrawals.get(p.pubkey);
              const fresh = !!w && !seenPaid.current!.has(p.pubkey);
              const paid = !!w || points;
              return (
                <li
                  key={p.pubkey}
                  className={`hd-rise relative flex items-center gap-2.5 rounded-tile px-2.5 py-0.5 ${paid ? 'bg-gold-50' : 'bg-canvas'}`}
                  style={d(400 + i * 80)}
                >
                  <Avatar name={p.name} size="1.6rem" />
                  <span className="min-w-0 flex-1 truncate text-body font-semibold">{p.name}</span>
                  <span className={`text-small font-semibold ${paid ? 'text-gold-600' : 'text-ink-muted'}`}>{points ? 'Final' : w ? CHAIN_LABEL.withdraw : 'Waiting'}</span>
                  {w?.explorerUrl && (
                    <a
                      href={w.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-small font-semibold text-zap underline decoration-zap-200 underline-offset-4 hover:decoration-zap"
                    >
                      receipt
                    </a>
                  )}
                  <span className={`num text-title ${paid ? 'text-ink' : 'text-ink-muted'}`}>
                    <Roll text={moneyShort(p.payout ?? p.balance, party)} value={p.payout ?? p.balance} duration={900} />
                  </span>
                  {fresh && <span className="hd-coin left-0 top-1/2" style={{ ['--dx' as string]: '20rem', ['--dy' as string]: '0' } as CSSProperties} aria-hidden="true" />}
                </li>
              );
            })}
          </ul>
          <div className={`border-t border-rule pt-2.5 ${points ? '' : 'mt-auto'}`}>
            <ScorecardPanel scorecard={s.scorecard} compact />
          </div>
        </section>
      </div>
      <CaptionBar lines={s.announcer} />
    </div>
  );
}
