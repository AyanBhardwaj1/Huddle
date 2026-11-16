import type { Market, MarketState } from '@huddle/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
import {
  CaptionBar,
  DisputeBanner,
  GameTile,
  LeaderStrip,
  MarketTakeover,
  ResultReveal,
  Scorebug,
  TradeTicker,
} from '../components/board';
import { BoxButtons } from '../components/controls';
import { HostPanel } from '../components/HostPanel';
import { Icon } from '../components/ui';
import { activeMoment, detectSettled, disputed, gameTiles, resultSummary } from '../lib/derive';
import { useParty } from '../party';
import { useBox } from '../store';
import { ScorecardPanel } from './Scorecard';

const REVEAL_MS = 6500;

/** Queue of result reveals for markets that settle while the board is up. */
function useRevealQueue(markets: Market[]): [Market | null, () => void] {
  const prev = useRef<Map<string, MarketState>>(new Map());
  const [queue, setQueue] = useState<Market[]>([]);
  useEffect(() => {
    const settled = detectSettled(prev.current, markets);
    prev.current = new Map(markets.map((m) => [m.id, m.state]));
    if (settled.length) setQueue((q) => [...q, ...settled.filter((m) => !q.some((x) => x.id === m.id))]);
  }, [markets]);
  const head = queue[0] ?? null;
  useEffect(() => {
    if (!head) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), REVEAL_MS);
    return () => clearTimeout(t);
  }, [head]);
  return [head, () => setQueue((q) => q.slice(1))];
}

function IdleHero({ joinUrl, code }: { joinUrl: string; code: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-10 rounded-card border-2 border-dashed border-pitch-700">
      <div className="max-w-[30rem]">
        <div className="kicker mb-2">Stay ready</div>
        <div className="font-display text-[3.4rem] font-bold uppercase leading-[0.95]">The next question drops on the next big moment</div>
        <p className="mt-3 text-[1.1rem] text-pitch-200">Penalties, corners, third downs: the AI opens a market the second it happens.</p>
      </div>
      <div className="flex flex-col items-center gap-2">
        <div className="rounded-xl bg-white p-2">
          <QRCodeSVG value={joinUrl} size={256} style={{ width: '10rem', height: '10rem' }} />
        </div>
        <span className="font-display text-[1.4rem] font-bold uppercase tracking-[0.2em]">Join · {code}</span>
      </div>
    </div>
  );
}

export function LiveBoard() {
  const { view } = useParty();
  const s = view.snapshot!;
  const boardView = useBox((st) => st.view);
  const setView = useBox((st) => st.setView);
  const takeover = activeMoment(s.markets);
  const tiles = gameTiles(s.markets);
  const ds = disputed(s.markets);
  const [reveal, dismissReveal] = useRevealQueue(s.markets);

  return (
    <div className="relative flex h-full flex-col">
      <Scorebug
        game={s.game}
        party={s.party}
        right={
          <>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <div className="rounded bg-white p-[0.15rem]">
                <QRCodeSVG value={s.party.joinUrl} size={128} style={{ width: '2.9rem', height: '2.9rem' }} />
              </div>
              <div className="flex flex-col leading-none">
                <span className="kicker text-[0.65rem]">Join</span>
                <span className="font-display text-[1.6rem] font-bold tracking-[0.15em]">{s.party.code}</span>
              </div>
            </div>
            <BoxButtons canLock={takeover?.state === 'open'} />
          </>
        }
      />
      {ds.length > 0 && <DisputeBanner markets={ds} players={s.players} onOpen={() => setView('host')} />}
      <main className="relative min-h-0 flex-1 px-3 py-2">
        <AnimatePresence mode="wait">
          {takeover ? (
            <MarketTakeover key={takeover.id} market={takeover} />
          ) : tiles.length > 0 ? (
            <motion.div
              key="tiles"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`grid h-full gap-3 ${tiles.length > 2 ? 'grid-cols-2 grid-rows-2' : tiles.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}
            >
              {tiles.map((m) => (
                <GameTile key={m.id} market={m} />
              ))}
            </motion.div>
          ) : (
            <motion.div key="idle" className="h-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <IdleHero joinUrl={s.party.joinUrl} code={s.party.code} />
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {reveal && <ResultReveal key={reveal.id} market={reveal} summary={resultSummary(reveal, s.fills)} party={s.party} onDone={dismissReveal} />}
        </AnimatePresence>
      </main>
      <div className="flex h-[2.6rem] shrink-0 items-center gap-4 overflow-hidden px-3">
        <LeaderStrip players={s.players} party={s.party} max={4} />
        <TradeTicker />
      </div>
      <CaptionBar lines={s.announcer} />

      <AnimatePresence>
        {boardView === 'host' && <HostPanel key="host" />}
        {boardView === 'scorecard' && (
          <motion.div
            key="scorecard"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            className="absolute inset-x-3 bottom-[3.6rem] top-[4.4rem] z-40 rounded-card bg-pitch-950/[0.97] p-6 shadow-2xl ring-1 ring-pitch-600"
          >
            <button className="btn-ghost absolute right-4 top-4 min-h-[2.6rem] px-3" onClick={() => setView('board')} aria-label="Close scorecard">
              <Icon name="x" className="h-5 w-5" />
            </button>
            <ScorecardPanel scorecard={s.scorecard} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
