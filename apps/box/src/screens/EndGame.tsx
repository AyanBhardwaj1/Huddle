import type { ChainEvent, PlayerPublic } from '@huddle/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { CaptionBar } from '../components/board';
import { Icon, Wordmark } from '../components/ui';
import { formatSecs, isPoints, leaderboard, moneyShort, settlementSteps } from '../lib/derive';
import { useNow, useParty } from '../party';
import { useBox } from '../store';
import { ScorecardPanel } from './Scorecard';

const PODIUM_H = ['h-[9rem]', 'h-[6.5rem]', 'h-[5rem]'];
const PODIUM_ORDER = [1, 0, 2]; // 2nd, 1st, 3rd

const CHAIN_LABEL: Record<ChainEvent['kind'], string> = {
  create_party: 'Party opened',
  deposit: 'Buy-in',
  request_close: 'Party closed',
  submit_state: 'Balance submitted',
  finalize: 'Settled',
  withdraw: 'Payout landed',
};

export function EndGame() {
  const { view } = useParty();
  const setSession = useBox((s) => s.setSession);
  const setScreen = useBox((s) => s.setScreen);
  const now = useNow(500);
  const s = view.snapshot!;
  const party = s.party;
  const ranked = leaderboard(s.players);
  const steps = settlementSteps(party);
  const challengeLeft = party.status === 'closing' && party.chain.challengeEndsAt ? Math.max(0, Date.parse(party.chain.challengeEndsAt) - now) : null;
  const nameOf = (pk?: string) => s.players.find((p: PlayerPublic) => p.pubkey === pk)?.name;
  const events = [...view.chainEvents].reverse().slice(0, 6);
  const points = isPoints(party);

  return (
    <div className="flex h-full flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-[1.1fr_1fr] gap-4 p-4">
        {/* Podium + table */}
        <section className="flex min-h-0 flex-col gap-3">
          <div className="flex items-baseline gap-3">
            <Wordmark className="text-[1.5rem] text-pitch-200" />
            <span className="kicker">Final</span>
            <span className="tabular ml-auto font-display text-[1.8rem] font-bold">
              {s.game.home.short} {s.game.score.home} – {s.game.score.away} {s.game.away.short}
            </span>
          </div>
          <div className="flex items-end justify-center gap-3">
            {PODIUM_ORDER.map((idx) => {
              const p = ranked[idx];
              if (!p) return <div key={idx} className="w-[10rem]" />;
              return (
                <motion.div
                  key={p.pubkey}
                  className="flex w-[10.5rem] flex-col items-center"
                  initial={{ y: 60, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.25 * (2 - idx), type: 'spring', stiffness: 200, damping: 18 }}
                >
                  {idx === 0 && <Icon name="crown" className="h-9 w-9 text-volt" />}
                  <span className="max-w-full truncate font-display text-[2rem] font-bold leading-none">{p.name}</span>
                  <span className={`tabular font-display text-[1.6rem] font-bold ${p.pnl >= 0 ? 'text-up' : 'text-down'}`}>
                    {moneyShort(p.pnl, party, { sign: true })}
                  </span>
                  <div className={`mt-1 flex w-full items-start justify-center rounded-t-xl pt-2 ${PODIUM_H[idx]} ${idx === 0 ? 'bg-volt text-volt-ink' : 'bg-pitch-700 text-pitch-50'}`}>
                    <span className="font-display text-[3rem] font-bold leading-none">{idx + 1}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
            {ranked.slice(3).map((p, i) => (
              <div key={p.pubkey} className="flex items-center gap-3 rounded-lg bg-pitch-900 px-3 py-1.5 ring-1 ring-pitch-700">
                <span className="w-6 font-display text-[1.3rem] font-bold text-pitch-400">{i + 4}</span>
                <span className="flex-1 truncate text-[1.1rem] font-semibold">{p.name}</span>
                <span className={`tabular flex items-center gap-1 font-display text-[1.4rem] font-bold ${p.pnl >= 0 ? 'text-up' : 'text-down'}`}>
                  <Icon name={p.pnl >= 0 ? 'up' : 'down'} className="h-3.5 w-3.5" />
                  {moneyShort(p.pnl, party, { sign: true })}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Scorecard + settlement */}
        <section className="flex min-h-0 flex-col gap-3">
          <div className="card p-4">
            <ScorecardPanel scorecard={s.scorecard} compact />
          </div>
          <div className="card flex min-h-0 flex-1 flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              {steps.map((st, i) => (
                <div key={st.id} className="flex flex-1 items-center gap-2">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-[1.1rem] font-bold ${
                      st.state === 'done' ? 'bg-volt text-volt-ink' : st.state === 'active' ? 'bg-up text-up-ink' : 'bg-pitch-700 text-pitch-400'
                    }`}
                  >
                    {st.state === 'done' ? <Icon name="check" className="h-5 w-5" /> : i + 1}
                  </span>
                  <span className={`text-[0.95rem] font-semibold leading-tight ${st.state === 'todo' ? 'text-pitch-400' : ''}`}>
                    {st.label}
                    {st.id === 'closing' && challengeLeft !== null && <span className="tabular block font-display text-[1.6rem] text-up">{formatSecs(challengeLeft)}</span>}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[0.85rem] text-pitch-400">
              {points
                ? 'Points party: final scores are locked in, nothing to pay out.'
                : party.status === 'finalized'
                  ? 'Everyone has been paid out automatically.'
                  : 'Every balance is co-signed by its player, so payouts happen automatically after the window.'}
            </p>
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
              <AnimatePresence initial={false}>
                {events.map((e) => (
                  <motion.div
                    key={e.signature}
                    initial={{ opacity: 0, x: 20, backgroundColor: 'rgba(212,255,58,0.3)' }}
                    animate={{ opacity: 1, x: 0, backgroundColor: 'rgba(20,26,36,1)' }}
                    className="flex items-center gap-2 rounded-lg px-3 py-1 text-[0.95rem] ring-1 ring-pitch-700"
                  >
                    <Icon name={e.kind === 'withdraw' ? 'check' : 'link'} className={`h-4 w-4 ${e.kind === 'withdraw' ? 'text-volt' : 'text-pitch-400'}`} />
                    <span className="font-semibold">{CHAIN_LABEL[e.kind]}</span>
                    {nameOf(e.member) && <span className="text-pitch-200">· {nameOf(e.member)}</span>}
                    {e.amount !== undefined && <span className="tabular text-up">{moneyShort(e.amount, party)}</span>}
                    {e.explorerUrl && (
                      <a href={e.explorerUrl} target="_blank" rel="noreferrer" className="ml-auto text-[0.8rem] font-semibold text-up underline underline-offset-2">
                        receipt
                      </a>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            <button
              className="btn-volt mt-auto"
              onClick={() => {
                setSession(null);
                setScreen('create');
              }}
            >
              New party <Icon name="next" className="h-5 w-5" />
            </button>
          </div>
        </section>
      </div>
      <CaptionBar lines={s.announcer} />
    </div>
  );
}
