import { Icon, Mark, type IconName } from '@huddle/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CaptionHistory, Captions, useAnnouncer } from '../components/Captions';
import { act, cx, useParty } from '../components/ctx';
import { Header } from '../components/Header';
import { MarketCard } from '../components/MarketCard';
import { Backdrop, Empty, SectionTitle } from '../components/primitives';
import { DraftSheet, SyncCheck, TopUpSheet } from '../components/Sheets';
import { Leaderboard, MyBets, ScorecardView } from '../components/Tabs';
import { TalkButton } from '../components/TalkButton';
import { unlockAudio } from '../lib/audio';
import { groupMarkets } from '../lib/markets';
import { useApp } from '../lib/session';
import { EndOfGame } from './EndOfGame';

type Tab = 'markets' | 'bets' | 'board' | 'score';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'markets', label: 'Live', icon: 'bolt' },
  { id: 'bets', label: 'My bets', icon: 'ticket' },
  { id: 'board', label: 'Leaders', icon: 'trophy' },
  { id: 'score', label: 'Scorecard', icon: 'chart' },
];

export function Live() {
  const { snap, remote } = useParty();
  const wallet = useApp((s) => s.wallet?.publicKey ?? null);
  const fixture = useApp((s) => s.fixture);
  const speakerPref = useApp((s) => s.speakerPref);
  const setSpeaker = useApp((s) => s.setSpeaker);
  const speakerOn = speakerPref ?? remote; // default: on for remote players, off in the room
  const speaking = useAnnouncer(speakerOn);
  const [tab, setTab] = useState<Tab>('markets');
  const ended = snap.party.status === 'ended' || snap.party.status === 'closing' || snap.party.status === 'finalized';

  // The final whistle takes over: whatever tab you were on, the result and payout come to you.
  const wasEnded = useRef(ended);
  useEffect(() => {
    if (ended && !wasEnded.current) {
      setTab('markets');
      window.scrollTo({ top: 0 });
    }
    wasEnded.current = ended;
  }, [ended]);

  const toggleSpeaker = () => {
    if (!speakerOn) unlockAudio();
    setSpeaker(!speakerOn);
  };
  const active = TABS.findIndex((t) => t.id === tab);
  // During an open moment market the canvas behind turns to the two team colours (as on the box).
  const momentOpen = !ended && snap.markets.some((m) => m.kind === 'moment' && m.state === 'open');

  return (
    <div className="relative min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+11rem)]" data-testid="party-status" data-status={snap.party.status}>
      <Backdrop teams={momentOpen ? [snap.party.game.home.color, snap.party.game.away.color] : undefined} />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-gate focus:rounded-tile focus:bg-zap focus:px-4 focus:py-3 focus:text-zap-ink">
        Skip to the questions
      </a>
      <Header speakerOn={speakerOn} onSpeaker={toggleSpeaker} />
      <Banners />
      <main id="main" className="relative z-[1] mx-auto max-w-xl px-4 pt-4">
        {/* No AnimatePresence mode="wait" here: its exit sometimes never completed, which left the
            markets list on screen after the final whistle instead of the payout screen (found by e2e).
            Swap by key with a CSS entrance only. */}
        <div key={ended && tab === 'markets' ? 'end' : tab} className="hd-fade">
          {tab === 'markets' && (ended ? <EndOfGame /> : <MarketsTab />)}
          {tab === 'bets' && <MyBets />}
          {tab === 'board' && <Leaderboard />}
          {tab === 'score' && <ScorecardView />}
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-rail">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-3 pb-2">
          <Captions speaking={speaking} />
          {!ended && <TalkButton fixture={fixture} />}
        </div>
        <nav className="mx-auto max-w-xl rounded-t-blob bg-card pb-safe shadow-pop" aria-label="Party">
          <div className="relative grid grid-cols-4 px-1">
            <span
              className="absolute bottom-2 left-1 h-1 w-[calc((100%-0.5rem)/4)] transition-transform duration-[480ms] ease-spring"
              style={{ transform: `translateX(${active * 100}%)` }}
              aria-hidden="true"
            >
              <span className="mx-auto block h-full w-6 rounded-full bg-zap" />
            </span>
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  window.scrollTo({ top: 0 });
                }}
                className={cx(
                  'hd-press flex min-h-16 flex-col items-center justify-center gap-1 pb-2 text-cap font-bold',
                  tab === t.id ? 'text-zap' : 'text-ink-muted hover:text-ink-2',
                )}
                aria-current={tab === t.id ? 'page' : undefined}
              >
                <Icon name={t.icon} size={22} strokeWidth={tab === t.id ? 2.4 : 2} />
                {ended && t.id === 'markets' ? 'Final' : t.label}
              </button>
            ))}
          </div>
        </nav>
      </div>
      <DraftSheet />
      <TopUpSheet wallet={wallet} />
      <CaptionHistory />
    </div>
  );
}

function MarketsTab() {
  const { snap, remote } = useParty();
  const fixture = useApp((s) => s.fixture);
  const g = groupMarkets(snap.markets);
  const nothing = !g.moments.length && !g.game.length && !g.waiting.length && !g.settled.length;
  const pre = snap.party.status === 'lobby' || snap.game.status === 'pre';
  return (
    <div className="space-y-8">
      {(remote || fixture) && <SyncCheck />}
      {g.moments.length > 0 && (
        <Group title="Right now" count={g.moments.length}>
          {g.moments.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </Group>
      )}
      {g.game.length > 0 && (
        <Group title="All game" count={g.game.length}>
          {g.game.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </Group>
      )}
      {g.waiting.length > 0 && (
        <Group title="Waiting on the result" count={g.waiting.length}>
          {g.waiting.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </Group>
      )}
      {g.settled.length > 0 && (
        <Group title="Just settled" count={g.settled.length}>
          {g.settled.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </Group>
      )}
      {nothing && (
        <Empty mark>
          {pre ? 'Waiting for kickoff. Questions drop here as the game unfolds.' : 'The next question drops on the next big moment. Eyes on the game.'}
        </Empty>
      )}
    </div>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section>
      <SectionTitle count={count}>{title}</SectionTitle>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Connection and co-sign notices under the scorebug. They push content down, never cover it. */
function Banners() {
  const { view, client } = useParty();
  const notify = useApp((s) => s.notify);
  const [busy, setBusy] = useState(false);
  const reconnecting = view.status === 'reconnecting' || view.status === 'connecting';
  const mismatch = view.cosignMismatch;

  return (
    <>
      {reconnecting && (
        <div className="relative z-[1] mx-auto max-w-xl px-4 pt-3" role="status">
          <div className="hd-drop flex items-center gap-2.5 rounded-full bg-ink px-4 py-2.5 text-small font-semibold text-white shadow-pop">
            <Mark size="1.1rem" spin lit={3} className="text-white/40" />
            Reconnecting… your bets are safe.
          </div>
        </div>
      )}
      {mismatch && (
        <div className="relative z-[1] mx-auto max-w-xl px-4 pt-4">
          <div className="hd-rise rounded-panel bg-hot-50 p-4 shadow-lift ring-1 ring-inset ring-hot" role="alert">
            <p className="flex items-center gap-2 font-head text-lead font-extrabold text-ink">
              <Icon name="warn" size={20} className="text-hot-600" /> Your balance doesn't match
            </p>
            <p className="mt-1 text-pretty text-small text-ink-2">
              The box sent a balance your phone couldn't check, so your phone didn't approve it. Your last good balance is kept. Flag it so the host can
              take a look.
            </p>
            <button
              disabled={busy}
              onClick={async () => {
                const marketId = mismatch.state.entries.find((e) => e.marketId)?.marketId;
                if (!marketId) {
                  notify('Flagged. Let the host know too.', 'info');
                  return;
                }
                setBusy(true);
                const err = await act(client, { type: 'dispute', marketId, reason: `balance mismatch: ${mismatch.reason}`.slice(0, 200) });
                setBusy(false);
                notify(err ?? 'Flagged. The host will take a look.', err ? 'error' : 'info');
              }}
              className="btn-secondary mt-3"
            >
              <Icon name="flag" size={18} /> {busy ? 'Flagging…' : 'Flag it'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
