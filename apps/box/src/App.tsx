import { useEffect } from 'react';
import { SoundGate, TalkOverlay, useBoxInputs } from './components/controls';
import { Icon, LedRing, ToastHost, Wordmark } from './components/ui';
import { useFixtureView } from './fixture';
import { fixtureParam, type FixtureKind } from './lib/config';
import { LivePartyProvider, StaticPartyProvider, useParty } from './party';
import { CreateParty } from './screens/CreateParty';
import { EndGame } from './screens/EndGame';
import { Home } from './screens/Home';
import { LiveBoard, PartyOverlays } from './screens/LiveBoard';
import { Lobby } from './screens/Lobby';
import { useBox } from './store';

const FATAL = new Set(['unauthorized', 'not_found', 'party_closed']);

function Connecting() {
  const { view } = useParty();
  const setSession = useBox((s) => s.setSession);
  const session = useBox((s) => s.session);
  const err = view.lastError;
  const fatal = err && FATAL.has(err.code);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5">
      <Wordmark className="text-[4rem]" />
      {fatal ? (
        <>
          <p className="font-display text-[2rem] font-semibold uppercase text-down">Party {session?.partyCode} is not available</p>
          <p className="text-pitch-400">{err.message}</p>
        </>
      ) : (
        <p className="flex items-center gap-3 font-display text-[1.8rem] uppercase tracking-wide text-pitch-200">
          <span className="h-3 w-3 animate-ping rounded-full bg-volt" />
          {view.status === 'reconnecting' ? 'Reconnecting to the engine…' : `Joining party ${session?.partyCode ?? ''}…`}
        </p>
      )}
      <button className="btn-ghost" onClick={() => setSession(null)}>
        Leave this party
      </button>
    </div>
  );
}

export function PartyScreens() {
  const { view, fixture } = useParty();
  useBoxInputs();
  const s = view.snapshot;
  let screen;
  if (!s) screen = <Connecting />;
  else if (s.party.status === 'lobby') screen = <Lobby />;
  else if (s.party.status === 'live') screen = <LiveBoard />;
  else screen = <EndGame />;
  return (
    <>
      {s && <span hidden data-testid="party-status" data-status={s.party.status} />}
      {screen}
      {s && view.status === 'reconnecting' && (
        <div className="fixed left-1/2 top-2 z-[75] -translate-x-1/2 rounded-full bg-down px-4 py-1 text-[0.9rem] font-bold text-down-ink">
          Reconnecting…
        </div>
      )}
      <PartyOverlays />
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
    if (kind === 'scorecard') setView('scorecard');
  }, [kind, setView]);
  return (
    <StaticPartyProvider view={view}>
      <PartyScreens />
      <div className="pointer-events-none fixed bottom-[3.6rem] right-3 z-[65] flex items-center gap-1 rounded-full bg-pitch-800/90 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-widest text-pitch-400">
        <Icon name="warn" className="h-3 w-3" /> fixture
      </div>
    </StaticPartyProvider>
  );
}

export function App() {
  const session = useBox((s) => s.session);
  const screen = useBox((s) => s.screen);
  const fixture = fixtureParam();
  return (
    <div className="relative h-full w-full overflow-hidden bg-pitch-950">
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
  );
}
