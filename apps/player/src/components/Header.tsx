import { useApp } from '../lib/session';
import { money, pnl } from '../lib/money';
import { cx, useParty, useUi } from './ctx';
import { Icon } from './Icon';
import { Ticker } from './primitives';

/** Sticky scorebug: score + clock, your balance and P&L, speaker toggle. */
export function Header({ speakerOn, onSpeaker }: { speakerOn: boolean; onSpeaker: () => void }) {
  const { snap, meP, balance, points, remote } = useParty();
  const setTopUp = useUi((s) => s.setTopUp);
  const fixture = useApp((s) => s.fixture);
  const g = snap.game;
  const isLive = g.status === 'live';
  const profit = meP?.pnl ?? 0;
  const delay = snap.you?.delayMs;

  return (
    <header className="sticky top-0 z-30 border-b border-pitch-800 bg-pitch-950/90 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto max-w-xl px-4">
        <div className="flex items-center gap-3 pt-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <Team short={g.home.short} color={g.home.color} />
            <div className="flex items-center gap-1.5 rounded-lg bg-pitch-800 px-2.5 py-0.5 font-display text-[28px] font-bold leading-tight tnum">
              <Ticker value={g.score.home} format={(v) => String(Math.round(v))} flash={false} />
              <span className="text-pitch-600">–</span>
              <Ticker value={g.score.away} format={(v) => String(Math.round(v))} flash={false} />
            </div>
            <Team short={g.away.short} color={g.away.color} />
            <div className="ml-1 flex flex-col leading-none">
              <span className="font-display text-lg font-semibold text-pitch-200 tnum">{g.clock.display}</span>
              {isLive ? (
                <span className="mt-0.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-live">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" /> Live
                </span>
              ) : (
                <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-pitch-400">
                  {g.status === 'final' ? 'Final' : 'Pre-game'}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onSpeaker}
            className={cx('grid h-11 w-11 place-items-center rounded-full', speakerOn ? 'bg-volt/15 text-volt' : 'bg-pitch-800 text-pitch-400')}
            aria-label={speakerOn ? 'Mute the announcer' : 'Hear the announcer'}
            aria-pressed={speakerOn}
          >
            <Icon name={speakerOn ? 'speaker' : 'mute'} />
          </button>
        </div>

        <div className="flex items-end justify-between gap-3 pb-2.5 pt-2">
          <button onClick={() => setTopUp(true)} className="-ml-1 rounded-xl px-1 text-left active:bg-pitch-900" aria-label="Your balance, tap to top up">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-pitch-400">Your balance</div>
            <div className="flex items-baseline gap-2">
              <Ticker value={balance} format={(v) => money(Math.round(v), points)} className="font-display text-[30px] font-bold leading-none" />
              <span className="flex h-6 items-center gap-0.5 rounded-full bg-pitch-800 px-2 text-[11px] font-semibold text-volt">
                <Icon name="plus" size={12} /> Add
              </span>
            </div>
          </button>
          <div className="flex flex-col items-end gap-1">
            {(remote || fixture) && delay != null && (
              <span className="flex items-center gap-1 rounded-full bg-gemini/15 px-2 py-0.5 text-[11px] font-semibold text-gemini">
                <Icon name="globe" size={12} />
                {Math.abs(delay) < 3000
                  ? 'In sync with the room'
                  : `~${Math.round(Math.abs(delay) / 1000)} s ${delay > 0 ? 'behind' : 'ahead of'} the room`}
              </span>
            )}
            <div
              className={cx(
                'flex items-center gap-1 rounded-full px-2.5 py-1 font-display text-lg font-bold leading-none tnum',
                profit > 0 ? 'bg-up/15 text-up' : profit < 0 ? 'bg-down/15 text-down' : 'bg-pitch-800 text-pitch-200',
              )}
              aria-label={`Profit and loss ${pnl(profit, points)}`}
            >
              {profit !== 0 && <Icon name={profit > 0 ? 'up' : 'down'} size={14} />}
              <Ticker value={profit} format={(v) => pnl(Math.round(v), points)} flash={false} />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function Team({ short, color }: { short: string; color?: string }) {
  return (
    <span className="flex items-center gap-1.5 font-display text-xl font-bold uppercase tracking-wide">
      <span className="h-5 w-1.5 rounded-full" style={{ background: color ?? '#2C3748' }} />
      {short}
    </span>
  );
}
