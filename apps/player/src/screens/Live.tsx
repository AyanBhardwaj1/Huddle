import { motion } from 'framer-motion';
import { useState, type ReactNode } from 'react';
import { Captions, useAnnouncer } from '../components/Captions';
import { act, cx, useParty } from '../components/ctx';
import { Header } from '../components/Header';
import { Icon, Spinner, type IconName } from '../components/Icon';
import { MarketCard } from '../components/MarketCard';
import { DraftSheet, SyncCheck, TopUpSheet } from '../components/Sheets';
import { Empty, Leaderboard, MyBets, ScorecardView, SectionTitle } from '../components/Tabs';
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

  const toggleSpeaker = () => {
    if (!speakerOn) unlockAudio();
    setSpeaker(!speakerOn);
  };

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+168px)]" data-testid="party-status" data-status={snap.party.status}>
      <Header speakerOn={speakerOn} onSpeaker={toggleSpeaker} />
      <Banners />
      <main className="mx-auto max-w-xl px-4 pt-4">
        {/* No AnimatePresence mode="wait" here: its exit sometimes never completed, which left the
            markets list on screen after the final whistle instead of the payout screen (found by e2e). */}
          <motion.div key={ended && tab === 'markets' ? 'end' : tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
            {tab === 'markets' && (ended ? <EndOfGame /> : <MarketsTab />)}
            {tab === 'bets' && <MyBets />}
            {tab === 'board' && <Leaderboard />}
            {tab === 'score' && <ScorecardView />}
          </motion.div>
      </main>
      <Captions speaking={speaking} />
      {!ended && <TalkButton fixture={fixture} />}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-pitch-800 bg-pitch-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto grid max-w-xl grid-cols-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                window.scrollTo({ top: 0 });
              }}
              className={cx('flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold', tab === t.id ? 'text-volt' : 'text-pitch-400')}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              <Icon name={t.icon} size={22} />
              {ended && t.id === 'markets' ? 'Final' : t.label}
            </button>
          ))}
        </div>
      </nav>
      <DraftSheet />
      <TopUpSheet wallet={wallet} />
    </div>
  );
}

function MarketsTab() {
  const { snap, remote } = useParty();
  const fixture = useApp((s) => s.fixture);
  const g = groupMarkets(snap.markets);
  const nothing = !g.moments.length && !g.game.length && !g.waiting.length && !g.settled.length;
  return (
    <div className="space-y-6">
      {(remote || fixture) && <SyncCheck />}
      {g.moments.length > 0 && (
        <Group title="Right now" live>
          {g.moments.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </Group>
      )}
      {g.game.length > 0 && (
        <Group title="All game">
          {g.game.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </Group>
      )}
      {g.waiting.length > 0 && (
        <Group title="Waiting on the result">
          {g.waiting.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </Group>
      )}
      {g.settled.length > 0 && (
        <Group title="Just settled">
          {g.settled.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </Group>
      )}
      {nothing && (
        <Empty>
          {snap.party.status === 'lobby' || snap.game.status === 'pre'
            ? 'Waiting for kickoff. Questions pop up here as the game unfolds.'
            : 'Next question coming up. Keep your eyes on the game.'}
        </Empty>
      )}
    </div>
  );
}

function Group({ title, live, children }: { title: string; live?: boolean; children: ReactNode }) {
  return (
    <section>
      <SectionTitle>
        <span className="flex items-center gap-2">
          {live && <span className="h-2 w-2 animate-pulse rounded-full bg-live" />}
          {title}
        </span>
      </SectionTitle>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Connection, co-sign mismatch and delay notices under the scorebug. */
function Banners() {
  const { view, client } = useParty();
  const notify = useApp((s) => s.notify);
  const [busy, setBusy] = useState(false);
  const reconnecting = view.status === 'reconnecting' || view.status === 'connecting';
  const mismatch = view.cosignMismatch;

  return (
    <div className="mx-auto max-w-xl space-y-2 px-4 empty:hidden [&:not(:empty)]:pt-3">
      {reconnecting && (
        <div className="flex items-center gap-2 rounded-2xl bg-live/15 px-4 py-2.5 text-sm font-semibold text-live" role="status">
          <Spinner size={16} /> Reconnecting… your balance is safe.
        </div>
      )}
      {mismatch && (
        <div className="rounded-2xl border border-down/40 bg-down/10 p-4" role="alert">
          <div className="font-semibold text-down">Your balance doesn't match</div>
          <p className="mt-1 text-sm text-pitch-200">
            The box sent a balance we couldn't verify, so your phone didn't approve it. Your last good balance is kept.
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
            className="mt-3 flex min-h-[44px] items-center gap-2 rounded-xl bg-down px-4 font-semibold text-down-ink"
          >
            <Icon name="flag" size={16} /> Flag it
          </button>
        </div>
      )}
    </div>
  );
}
