import { Icon, Roll, useReplayClass } from '@huddle/ui';
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
 * The scorebug: a white pill with the team chips, the score in ink squares that beat when a goal
 * goes in, the clock and the live dot. Under it your balance (tap to top up) and tonight's P&L,
 * both rolling.
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
    <header className="sticky top-0 z-rail bg-canvas pt-safe shadow-[0_1px_0_#DCD9EA]">
      <div className="mx-auto max-w-xl px-4">
        <div className="flex items-center gap-3 pt-2.5">
          <div
            className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-card py-1.5 pl-1.5 pr-3.5 shadow-lift"
            aria-label={`${g.home.name} ${g.score.home}, ${g.away.name} ${g.score.away}, ${g.clock.display}`}
            role="group"
          >
            <span className="flex items-center gap-1.5" aria-hidden="true">
              <Team short={g.home.short} color={g.home.color ?? snap.party.game.home.color} />
              <Score n={g.score.home} />
              <Score n={g.score.away} />
              <Team short={g.away.short} color={g.away.color ?? snap.party.game.away.color} right />
            </span>
            <span className="ml-auto flex min-w-0 items-center gap-1.5 whitespace-nowrap" aria-hidden="true">
              {isLive && <span className="live-dot h-2 w-2 shrink-0 rounded-full bg-hot" />}
              <span className="num text-body text-ink">{g.clock.display}</span>
              {!isLive && g.status !== 'final' && <span className="text-cap text-ink-muted">{g.status === 'pre' ? 'Pre-game' : 'Replay'}</span>}
            </span>
          </div>
          <button
            onClick={onSpeaker}
            className={cx('btn h-11 w-11 shrink-0 rounded-full px-0', speakerOn ? 'bg-zap text-zap-ink shadow-zap' : 'bg-card text-ink-2 shadow-lift')}
            aria-label={speakerOn ? 'Mute the announcer' : 'Hear the announcer'}
            aria-pressed={speakerOn}
          >
            <Icon name={speakerOn ? 'speaker' : 'mute'} size={20} />
          </button>
        </div>

        <div className="flex items-end justify-between gap-3 pb-3 pt-2">
          <button
            onClick={() => setTopUp(true)}
            className="group -mx-2 -mb-1 flex min-h-11 items-end gap-2 rounded-tile px-2 pb-1 text-left transition-colors duration-quick hover:bg-card"
            aria-label={`Your balance ${money(balance, points)}. Add more`}
          >
            <span className="flex flex-col">
              <span className="text-cap font-semibold text-ink-muted">Your balance</span>
              <Money value={balance} points={points} className="num text-head leading-none text-ink" duration={700} />
            </span>
            <span className="mb-1 grid h-7 w-7 place-items-center rounded-full bg-zap-100 text-zap-deep transition-transform duration-quick group-hover:scale-110">
              <Icon name="plus" size={14} strokeWidth={2.6} />
            </span>
          </button>
          <div className="flex flex-col items-end gap-0.5 pb-0.5 text-right">
            {(remote || fixture) && delay != null && (
              <span className="flex items-center gap-1 text-cap text-ink-2">
                <Icon name="globe" size={13} />
                {delayText(delay)}
              </span>
            )}
            <span className="text-cap font-semibold text-ink-muted">Tonight</span>
            <span className={cx('num flex items-center gap-1 text-lead leading-none', profit > 0 ? 'text-yes-600' : profit < 0 ? 'text-no-600' : 'text-ink-2')}>
              {profit !== 0 && <Icon name={profit > 0 ? 'up' : 'down'} size={12} />}
              <Money value={profit} points={points} signed flash={false} duration={700} />
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

/** One side of the score: an ink square that beats when it changes. */
function Score({ n }: { n: number }) {
  const beat = useReplayClass(n, 'hd-beat');
  return (
    <span className={cx('num grid h-8 min-w-[1.9rem] place-items-center rounded-chip bg-ink px-1 text-title leading-none text-white', beat)}>
      <Roll text={String(n)} flash={false} duration={480} />
    </span>
  );
}

function Team({ short, color, right }: { short: string; color?: string; right?: boolean }) {
  return (
    <span className={cx('flex items-center gap-1.5 rounded-full px-2 py-1 font-head text-body font-extrabold uppercase text-ink', right && 'flex-row-reverse')}>
      <span className="h-3 w-3 rounded-full ring-2 ring-card" style={{ background: color ?? 'var(--k-rule-strong)' }} />
      {short}
    </span>
  );
}
