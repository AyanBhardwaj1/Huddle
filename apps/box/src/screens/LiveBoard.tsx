import type { Market, MarketState, Party } from '@huddle/shared';
import { Aurora, Kinetic, Mark } from '@huddle/ui';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
import { CaptionBar, DisputeBanner, GameBoard, LeaderRail, MomentStage, ResultReveal, Scorebug, TopBar, TradeTicker } from '../components/board';
import { BoxButtons } from '../components/controls';
import { activeMoment, detectSettled, disputed, gameTiles, resultSummary } from '../lib/derive';
import { useParty } from '../party';
import { useBox } from '../store';
import { ScorecardPanel } from './Scorecard';

const REVEAL_MS = 5500;
/** At most this many reveals wait in line; older ones are dropped (the phones and captions keep them). */
const MAX_QUEUE = 2;

/**
 * Queue of result reveals for markets that settle while the board is up. A reveal never covers a
 * moment market that is open for bets: when one opens (`openMomentId`), the queue is cleared.
 */
function useRevealQueue(markets: Market[], openMomentId: string | null): [Market | null, () => void] {
  const prev = useRef<Map<string, MarketState>>(new Map());
  const [queue, setQueue] = useState<Market[]>([]);
  useEffect(() => {
    const settled = detectSettled(prev.current, markets);
    prev.current = new Map(markets.map((m) => [m.id, m.state]));
    if (settled.length) setQueue((q) => [...q, ...settled.filter((m) => !q.some((x) => x.id === m.id))].slice(-MAX_QUEUE));
  }, [markets]);
  useEffect(() => {
    if (openMomentId) setQueue([]);
  }, [openMomentId]);
  const head = openMomentId ? null : (queue[0] ?? null);
  useEffect(() => {
    if (!head) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), REVEAL_MS);
    return () => clearTimeout(t);
  }, [head]);
  return [head, () => setQueue((q) => q.slice(1))];
}

/** "#C8102E" + alpha -> rgba(); unknown colours fall back to the brand violet. */
function hexA(hex: string | undefined, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return `rgba(108,43,255,${a})`;
  const n = Number.parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
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
    <div className="hd-drop flex items-center gap-2.5 rounded-full bg-card py-1 pl-1 pr-4 shadow-lift" style={{ ['--d' as string]: '80ms' }}>
      <span className="rounded-full bg-white p-[0.3rem] ring-1 ring-inset ring-rule">
        <QRCodeSVG value={party.joinUrl} size={128} fgColor="#14123A" style={{ width: '2.25rem', height: '2.25rem', display: 'block' }} title={`Join at ${party.joinUrl}`} />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-small font-semibold text-ink-2">Join</span>
        <span className="font-head text-title font-extrabold tracking-[0.08em]" translate="no">
          {party.code}
        </span>
      </span>
    </div>
  );
}

function IdleStage({ party }: { party: Party }) {
  return (
    <section className="hd-zoom card flex h-full items-center gap-10 rounded-blob px-10 shadow-pop" aria-label="Waiting for the next moment">
      <div className="min-w-0 flex-1">
        <Mark size="3.5rem" lit={12} className="hd-breathe mb-5 text-rule-strong" />
        <h1 className="q text-display leading-[0.95]">
          <Kinetic text="The next question drops on the next big moment." delay={100} />
        </h1>
        <p className="hd-rise mt-4 max-w-[34rem] text-lead text-ink-2" style={{ ['--d' as string]: '520ms' }}>
          Penalties, corners, third downs: the moment it happens, a market opens here and on every phone.
        </p>
      </div>
      <div className="hd-pop flex shrink-0 flex-col items-center gap-3" style={{ ['--d' as string]: '300ms' }}>
        <span className="hd-float rounded-panel bg-white p-3 shadow-pop ring-1 ring-inset ring-rule">
          <QRCodeSVG value={party.joinUrl} size={256} fgColor="#14123A" style={{ width: '10.5rem', height: '10.5rem', display: 'block' }} title={`Join at ${party.joinUrl}`} />
        </span>
        <span className="text-body font-semibold text-ink-2">Late? Scan to join</span>
        <span className="font-head text-head font-extrabold tracking-[0.08em]" translate="no">
          {party.code}
        </span>
        <span className="text-small text-ink-muted">{joinHost(party.joinUrl)}</span>
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
  const [reveal, dismissReveal] = useRevealQueue(s.markets, takeover?.state === "open" ? takeover.id : null);

  let stage;
  if (boardView === 'scorecard') {
    stage = (
      <section className="hd-zoom card h-full overflow-hidden rounded-blob px-8 py-6 shadow-pop">
        <ScorecardPanel scorecard={s.scorecard} />
      </section>
    );
  } else if (takeover) stage = <MomentStage key={takeover.id} market={takeover} compact={docked} tight={ds.length > 0} />;
  else if (tiles.length > 0) stage = <GameBoard markets={tiles} />;
  else stage = <IdleStage party={s.party} />;

  // Team colours tint the room while a moment market is up; the brand field otherwise.
  const g = s.game;
  const blobs = takeover
    ? [
        { c: hexA(g.home.color, 0.2), x: '-14vmax', y: '-10vmax', s: '58vmax', mx: '6vmax', my: '5vmax', dur: '18s' },
        { c: hexA(g.away.color, 0.2), x: '58vw', y: '20vh', s: '58vmax', mx: '-6vmax', my: '-5vmax', dur: '22s', d: '-5s' },
        { c: 'rgba(108,43,255,0.16)', x: '20vw', y: '50vh', s: '48vmax', mx: '5vmax', my: '-4vmax', dur: '26s', d: '-9s' },
      ]
    : undefined;

  return (
    <div className="relative flex h-full min-w-0 flex-col bg-canvas">
      <Aurora key={takeover ? 'moment' : 'calm'} blobs={blobs} className="hd-fade" />
      <TopBar
        left={<Scorebug game={s.game} party={s.party} />}
        middle={docked ? null : <JoinChip party={s.party} />}
        right={<BoxButtons canLock={takeover?.state === "open"} showLock={!!takeover} compact={docked} />}
      />
      {ds.length > 0 && (
        <div className="relative z-10 shrink-0 px-4 pt-1">
          <DisputeBanner markets={ds} players={s.players} onOpen={() => setView('host')} />
        </div>
      )}
      <main className="relative z-10 min-h-0 flex-1 px-4 py-2.5">
        {stage}
        {reveal && boardView !== 'scorecard' && (
          <div className="absolute inset-x-4 inset-y-2.5">
            <ResultReveal key={reveal.id} market={reveal} summary={resultSummary(reveal, s.fills)} party={s.party} onDone={dismissReveal} />
          </div>
        )}
      </main>
      <footer className="relative z-10 flex h-[3rem] shrink-0 items-center gap-3 overflow-hidden px-4">
        <LeaderRail players={s.players} party={s.party} max={docked ? 3 : 4} />
        {!docked && <TradeTicker />}
      </footer>
      <CaptionBar lines={s.announcer} />
    </div>
  );
}
