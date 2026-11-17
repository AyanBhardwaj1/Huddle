import type { Market, MarketState, Party } from '@huddle/shared';
import { Mark } from '@huddle/ui';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
import { CaptionBar, DisputeBanner, GameBoard, LeaderRail, MomentStage, ResultReveal, Scorebug, TopBar, TradeTicker } from '../components/board';
import { BoxButtons } from '../components/controls';
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

function joinHost(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

/** Small "join late" chip for the top bar. */
export function JoinChip({ party }: { party: Party }) {
  return (
    <div className="flex items-center gap-3">
      <span className="rounded-[4px] bg-chalk p-[0.18rem]">
        <QRCodeSVG value={party.joinUrl} size={128} style={{ width: '2.5rem', height: '2.5rem', display: 'block' }} title={`Join at ${party.joinUrl}`} />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-small text-night-400">Join</span>
        <span className="font-display text-title font-extrabold tracking-[0.12em]" style={{ fontStretch: '125%' }} translate="no">
          {party.code}
        </span>
      </span>
    </div>
  );
}

function IdleStage({ party }: { party: Party }) {
  return (
    <section className="hd-fade flex h-full items-center gap-10 rounded-panel bg-night-900 px-10" aria-label="Waiting for the next moment">
      <div className="min-w-0 flex-1">
        <Mark size="3.25rem" lit={1} className="hd-breathe mb-5 text-night-600" />
        <h1 className="q text-display leading-[0.95]">The next question drops on the next big moment.</h1>
        <p className="mt-4 max-w-[34rem] text-lead text-night-200">
          Penalties, corners, third downs: the moment it happens, a market opens here and on every phone.
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-3">
        <span className="rounded-tile bg-chalk p-3">
          <QRCodeSVG value={party.joinUrl} size={256} style={{ width: '10.5rem', height: '10.5rem', display: 'block' }} title={`Join at ${party.joinUrl}`} />
        </span>
        <span className="text-body text-night-200">Late? Scan to join</span>
        <span className="font-display text-head font-extrabold tracking-[0.12em]" style={{ fontStretch: '125%' }} translate="no">
          {party.code}
        </span>
        <span className="text-small text-night-400">{joinHost(party.joinUrl)}</span>
      </div>
    </section>
  );
}

export function LiveBoard() {
  const { view } = useParty();
  const s = view.snapshot!;
  const boardView = useBox((st) => st.view);
  const setView = useBox((st) => st.setView);
  const docked = boardView === 'host';
  const takeover = activeMoment(s.markets);
  const tiles = gameTiles(s.markets);
  const ds = disputed(s.markets);
  const [reveal, dismissReveal] = useRevealQueue(s.markets);

  let stage;
  if (boardView === 'scorecard') {
    stage = (
      <section className="hd-fade h-full overflow-hidden rounded-panel bg-night-900 px-8 py-6">
        <ScorecardPanel scorecard={s.scorecard} />
      </section>
    );
  } else if (takeover) stage = <MomentStage key={takeover.id} market={takeover} compact={docked} tight={ds.length > 0} />;
  else if (tiles.length > 0) stage = <GameBoard markets={tiles} />;
  else stage = <IdleStage party={s.party} />;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <TopBar
        left={<Scorebug game={s.game} party={s.party} />}
        middle={docked ? null : <JoinChip party={s.party} />}
        right={<BoxButtons canLock={takeover?.state === "open"} showLock={!!takeover} compact={docked} />}
      />
      {ds.length > 0 && (
        <div className="shrink-0 px-4 pt-3">
          <DisputeBanner markets={ds} players={s.players} onOpen={() => setView('host')} />
        </div>
      )}
      <main className="relative min-h-0 flex-1 px-4 py-3">
        {stage}
        {reveal && boardView !== 'scorecard' && (
          <div className="absolute inset-x-4 inset-y-3">
            <ResultReveal key={reveal.id} market={reveal} summary={resultSummary(reveal, s.fills)} party={s.party} onDone={dismissReveal} />
          </div>
        )}
      </main>
      <footer className="flex h-[3rem] shrink-0 items-center gap-6 overflow-hidden border-t border-night-700 px-4">
        <LeaderRail players={s.players} party={s.party} max={docked ? 3 : 4} />
        {!docked && <TradeTicker />}
      </footer>
      <CaptionBar lines={s.announcer} />
    </div>
  );
}
