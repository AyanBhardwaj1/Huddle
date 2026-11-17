import { Icon, Roll } from '@huddle/ui';
import { money } from '../lib/money';
import { useApp } from '../lib/session';
import { cx, useParty, useUi } from './ctx';
import { Money } from './primitives';

/** "25 s behind the room" / "In sync with the room". */
export function delayText(delay: number): string {
  if (Math.abs(delay) < 3000) return 'In sync with the room';
  const s = Math.round(Math.abs(delay) / 1000);
  const amount = s >= 90 ? `${Math.round(s / 60)}\u00a0min` : `${s}\u00a0s`;
  return `${amount} ${delay > 0 ? 'behind' : 'ahead of'} the room`;
}

/**
 * The scorebug: a broadcast score strip, then your balance (tap to top up) and tonight's P&L.
 * Solid night surface with one hairline; nothing glows.
 */
export function Header({ speakerOn, onSpeaker }: { speakerOn: boolean; onSpeaker: () => void }) {
  const { snap, meP, balance, points, remote } = useParty();
  const setTopUp = useUi((s) => s.setTopUp);
  const fixture = useApp((s) => s.fixture);
  const g = snap.game;
  const isLive = g.status === 'live';
  const profit = meP?.pnl ?? 0;
  const delay = snap.you?.delayMs;

  return (
    <header className="sticky top-0 z-rail border-b border-night-700 bg-night-950 pt-safe">
      <div className="mx-auto max-w-xl px-4">
        <div className="flex h-14 items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3" aria-label={`${g.home.name} ${g.score.home}, ${g.away.name} ${g.score.away}, ${g.clock.display}`} role="group">
            <div className="flex items-stretch overflow-hidden rounded-chip bg-night-900 font-display font-extrabold stretch-condensed" aria-hidden="true">
              <Team short={g.home.short} color={g.home.color ?? snap.party.game.home.color} />
              <span className="flex items-center bg-night-800 px-2.5 text-title tnum">
                <Roll text={String(g.score.home)} flash={false} />
                <span className="mx-1 text-night-500">–</span>
                <Roll text={String(g.score.away)} flash={false} />
              </span>
              <Team short={g.away.short} color={g.away.color ?? snap.party.game.away.color} right />
            </div>
            <div className="flex min-w-0 flex-col leading-tight" aria-hidden="true">
              <span className="font-display text-body font-bold stretch-condensed text-chalk tnum">{g.clock.display}</span>
              {isLive ? (
                <span className="flex items-center gap-1.5 text-cap font-semibold text-night-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-live hd-breathe" /> Live
                </span>
              ) : (
                <span className="text-cap text-night-400">{g.status === 'final' ? 'Full time' : g.status === 'pre' ? 'Pre-game' : 'Replay'}</span>
              )}
            </div>
          </div>
          <button
            onClick={onSpeaker}
            className={cx('btn-quiet h-11 w-11 shrink-0 px-0', speakerOn && 'text-flood')}
            aria-label={speakerOn ? 'Mute the announcer' : 'Hear the announcer'}
            aria-pressed={speakerOn}
          >
            <Icon name={speakerOn ? 'speaker' : 'mute'} size={22} />
          </button>
        </div>

        <div className="flex items-end justify-between gap-3 pb-3">
          <button
            onClick={() => setTopUp(true)}
            className="group -mx-2 -mb-1 flex min-h-11 items-end gap-2 rounded-tile px-2 pb-1 text-left transition-colors duration-quick hover:bg-night-900"
            aria-label={`Your balance ${money(balance, points)}. Add more`}
          >
            <span className="flex flex-col">
              <span className="text-cap text-night-400">Your balance</span>
              <Money value={balance} points={points} className="text-head font-extrabold stretch-condensed leading-none" />
            </span>
            <span className="mb-1 grid h-6 w-6 place-items-center rounded-chip bg-night-800 text-night-200 transition-colors duration-quick group-hover:text-chalk">
              <Icon name="plus" size={14} />
            </span>
          </button>
          <div className="flex flex-col items-end gap-0.5 pb-0.5 text-right">
            {(remote || fixture) && delay != null && (
              <span className="flex items-center gap-1 text-cap text-night-200">
                <Icon name="globe" size={13} />
                {delayText(delay)}
              </span>
            )}
            <span className="text-cap text-night-400">Tonight</span>
            <span
              className={cx(
                'flex items-center gap-1 font-display text-lead font-extrabold leading-none stretch-condensed',
                profit > 0 ? 'text-yes' : profit < 0 ? 'text-no' : 'text-night-200',
              )}
            >
              {profit !== 0 && <Icon name={profit > 0 ? 'up' : 'down'} size={12} />}
              <Money value={profit} points={points} signed flash={false} />
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

function Team({ short, color, right }: { short: string; color?: string; right?: boolean }) {
  return (
    <span className={cx('flex items-center gap-1.5 px-2.5 text-lead uppercase', right && 'flex-row-reverse')}>
      <span className="h-4 w-1 rounded-full" style={{ background: color ?? 'var(--c-night-600)' }} />
      {short}
    </span>
  );
}
