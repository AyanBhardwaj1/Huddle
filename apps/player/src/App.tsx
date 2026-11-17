import { Mark } from '@huddle/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { FixtureClient, fixtureVariant } from './fixture';
import { useApp, useView } from './lib/session';
import { Home } from './screens/Home';
import { PartyRoute, PartyShell } from './screens/Party';

export function App() {
  const [variant] = useState(fixtureVariant);
  return variant ? <FixtureApp variant={variant} /> : <RealApp />;
}

function RealApp() {
  const booted = useApp((s) => s.booted);
  const boot = useApp((s) => s.boot);
  const path = useApp((s) => s.path);
  const [bootError, setBootError] = useState(false);

  useEffect(() => {
    boot().catch(() => setBootError(true));
  }, [boot]);

  if (bootError)
    return (
      <Centered>
        <Mark size="3rem" className="text-night-600" />
        <p className="mt-5 max-w-[28ch] text-pretty text-body text-chalk">This browser blocked storage, so Huddle can't keep your seat.</p>
        <p className="mt-1 text-small text-night-400">Turn off private browsing, then reload.</p>
      </Centered>
    );
  if (!booted)
    return (
      <Centered>
        <Mark size="2.5rem" spin className="text-night-600" />
        <span className="sr-only">Opening Huddle…</span>
      </Centered>
    );

  const m = path.match(/^\/j\/([A-Za-z0-9]{3,12})\/?$/);
  if (m) return <PartyRoute code={m[1]!} />;
  return <Home />;
}

function FixtureApp({ variant }: { variant: string }) {
  const [client] = useState(() => new FixtureClient(variant));
  const start = useApp((s) => s.startFixture);
  const view = useView(client);
  useEffect(() => start(client), [client, start]);
  if (!view.snapshot) return null;
  return <PartyShell client={client} view={view} remote={false} />;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[100dvh] flex-col items-center justify-center px-8 text-center">{children}</div>;
}
