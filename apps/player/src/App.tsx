import { useEffect, useState, type ReactNode } from 'react';
import { Spinner } from './components/Icon';
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
    return <Centered>This browser blocked storage. Turn off private browsing and reload.</Centered>;
  if (!booted)
    return (
      <Centered>
        <Spinner size={28} />
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
  return <div className="grid min-h-[100dvh] place-items-center px-8 text-center text-pitch-200">{children}</div>;
}
