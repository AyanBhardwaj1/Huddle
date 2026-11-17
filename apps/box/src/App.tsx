import { MotionConfig } from 'framer-motion';
import { useEffect } from 'react';
import { SoundGate, TalkOverlay, useBoxInputs } from './components/controls';
import { HostPanel } from './components/HostPanel';
import { Aurora, Kinetic } from '@huddle/ui';
import { Icon, LedRing, Mark, ToastHost, Wordmark } from './components/ui';
import { fixtureFlags, useFixtureView } from './fixture';
import { fixtureParam, type FixtureKind } from './lib/config';
import { LivePartyProvider, StaticPartyProvider, useParty } from './party';
import { CreateParty } from './screens/CreateParty';
import { EndGame } from './screens/EndGame';
import { Home } from './screens/Home';
import { Kit } from './screens/Kit';
import { LiveBoard } from './screens/LiveBoard';
import { Lobby } from './screens/Lobby';
import { ScorecardPanel } from './screens/Scorecard';
import { useBox } from './store';

const FATAL = new Set(['unauthorized', 'not_found', 'party_closed']);

function Connecting() {
  const { view } = useParty();
  const setSession = useBox((s) => s.setSession);
  const session = useBox((s) => s.session);
  const err = view.lastError;
  const fatal = err && FATAL.has(err.code);
  return (
    <main className="relative flex h-full flex-col items-start justify-center gap-6 bg-canvas px-16">
      <Aurora />
      <Wordmark className="hd-drop relative text-title" />
      {fatal ? (
        <>
          <h1 className="q relative text-display">
            <Kinetic text={`Party ${session?.partyCode ?? ""} isn’t available.`} />
          </h1>
          <p className="hd-rise relative max-w-[40rem] text-lead text-ink-2" style={{ ['--d' as string]: '300ms' }}>
            {err.message}. Leave it and start a new party from the home screen.
          </p>
        </>
      ) : (
        <div className="relative flex items-center gap-5" role="status" aria-live="polite">
          <Mark size="4rem" lit={3} spin className="text-rule-strong" />
          <h1 className="q text-display">
            <Kinetic text={view.status === 'reconnecting' ? 'Reconnecting to the engine…' : `Joining party ${session?.partyCode ?? ''}…`} />
          </h1>
        </div>
      )}
      <button type="button" className={`relative ${fatal ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSession(null)}>
        Leave this party
      </button>
    </main>
  );
}

/** Scorecard as a full screen (NEXT from the lobby or the end screen). */
function ScorecardScreen() {
  const { view } = useParty();
  const setView = useBox((s) => s.setView);
  return (
    <main className="relative flex h-full flex-col bg-canvas p-4">
      <div className="hd-zoom card relative flex min-h-0 flex-1 flex-col rounded-blob px-10 py-7 shadow-pop">
      <button type="button" className="btn-secondary absolute right-6 top-6 min-h-[2.75rem] px-3" onClick={() => setView('board')} aria-label="Close the scorecard">
        <Icon name="x" className="h-5 w-5" />
      </button>
      <ScorecardPanel scorecard={view.snapshot!.scorecard} />
      </div>
    </main>
  );
}

export function PartyScreens() {
  const { view, fixture } = useParty();
  const boardView = useBox((s) => s.view);
  useBoxInputs();
  const s = view.snapshot;
  let screen;
  if (!s) screen = <Connecting />;
  else if (s.party.status === 'live') screen = <LiveBoard />;
  else if (boardView === 'scorecard') screen = <ScorecardScreen />;
  else if (s.party.status === 'lobby') screen = <Lobby />;
  else screen = <EndGame />;
  const docked = !!s && boardView === 'host';
  return (
    <>
      {s && <span hidden data-testid="party-status" data-status={s.party.status} />}
      {/* Host controls dock beside the screen; the screen reflows, nothing is covered. */}
      <div className="grid h-full" style={{ gridTemplateColumns: docked ? 'minmax(0,1fr) auto' : 'minmax(0,1fr)', gridTemplateRows: 'minmax(0,1fr)' }}>
        <div className="relative h-full min-w-0">{screen}</div>
        {docked && <HostPanel />}
      </div>
      {s && view.status === 'reconnecting' && (
        <div
          className="hd-drop fixed left-1/2 top-[0.85rem] z-toast flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-ink py-1.5 pl-1.5 pr-4 text-small font-semibold text-white shadow-pop"
          role="status"
        >
          <Mark size="1.5rem" lit={3} spin className="text-white/40" /> Reconnecting… bets are safe
        </div>
      )}
      <LedRing led={view.led} />
      <TalkOverlay />
      {!fixture && <SoundGate />}
    </>
  );
}

function FixtureApp({ kind }: { kind: FixtureKind }) {
  const view = useFixtureView(kind);
  const setView = useBox((s) => s.setView);
  useEffect(() => {
    const v = fixtureFlags(kind).view;
    if (v) setView(v);
  }, [kind, setView]);
  return (
    <StaticPartyProvider view={view}>
      <PartyScreens />
      <div className="pointer-events-none fixed bottom-[4.1rem] right-4 z-toast flex items-center gap-1 rounded-full bg-card/90 px-2 py-0.5 text-cap text-ink-muted shadow-lift">
        <Icon name="warn" className="h-3 w-3" /> Fixture: {kind}
      </div>
    </StaticPartyProvider>
  );
}

export function App() {
  const session = useBox((s) => s.session);
  const screen = useBox((s) => s.screen);
  const fixture = fixtureParam();
  if (fixture === 'kit') return <Kit />;
  return (
    // reducedMotion="user": framer layout springs (leaderboard, lobby) honour prefers-reduced-motion.
    <MotionConfig reducedMotion="user">
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      {fixture ? (
        <FixtureApp kind={fixture} />
      ) : session ? (
        <LivePartyProvider key={session.partyCode} session={session}>
          <PartyScreens />
        </LivePartyProvider>
      ) : screen === 'create' ? (
        <CreateParty />
      ) : (
        <Home />
      )}
      <ToastHost />
    </div>
    </MotionConfig>
  );
}
