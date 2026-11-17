import type { GameInfo, MarketMode, Persona, SettlementMode } from '@huddle/shared';
import { Mark } from '@huddle/ui';
import { useEffect, useMemo, useState } from 'react';
import { Icon, Segmented, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { groupGames, MODE_BLURB, MODE_LABEL, personaForSport } from '../lib/derive';
import { providerName } from '../lib/health';
import { useBox } from '../store';
import { useHealth } from './Home';

const SPORT_LABEL: Record<string, string> = { soccer: 'Soccer', nfl: 'NFL' };
const STATUS_LABEL: Record<string, string> = { live: 'Live now', replay: 'Replay', scheduled: 'Later', final: 'Finished' };

export function CreateParty() {
  const setScreen = useBox((s) => s.setScreen);
  const setSession = useBox((s) => s.setSession);
  const { health } = useHealth(15000);
  const [games, setGames] = useState<GameInfo[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [mode, setMode] = useState<MarketMode>('pool');
  const [buyIn, setBuyIn] = useState(10);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [settlement, setSettlement] = useState<SettlementMode | null>(null);
  const [autoApprove, setAutoApprove] = useState(true);
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);

  useEffect(() => {
    setLoadErr(null);
    api
      .games()
      .then((g) => {
        setGames(g);
        setGameId((cur) => cur ?? g.find((x) => x.status === 'replay')?.id ?? g[0]?.id ?? null);
      })
      .catch((e: Error) => setLoadErr(e.message));
  }, [n]);

  // Default the settlement choice to what the engine runs with.
  const engineSettlement = providerName(health?.settlement);
  const effSettlement: SettlementMode =
    settlement ?? (engineSettlement?.includes('vault') ? 'vault' : engineSettlement?.includes('trust') ? 'trusted' : 'points');

  const groups = useMemo(() => groupGames(games ?? []), [games]);
  const game = games?.find((g) => g.id === gameId) ?? null;
  const effPersona: Persona = persona ?? (game ? personaForSport(game.sport) : 'soccer');

  const create = async () => {
    if (!game) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.createParty({
        name: `${game.home.short} vs ${game.away.short} party`.slice(0, 40),
        gameId: game.id,
        defaultMode: mode,
        buyIn,
        houseBudget: 50,
        persona: effPersona,
        settlement: effSettlement,
        autoApprove,
      });
      setSession({ partyCode: res.party.code, hostToken: res.hostToken });
    } catch (e) {
      setErr(`${(e as Error).message}. Check the engine is running, then try again.`);
      setBusy(false);
    }
  };

  return (
    <main className="flex h-full flex-col">
      <header className="flex h-[3.75rem] shrink-0 items-center gap-3 border-b border-night-700 px-4">
        <button type="button" className="btn-quiet min-h-[2.75rem] px-3" onClick={() => setScreen('home')} aria-label="Back to the home screen">
          <Icon name="arrowLeft" className="h-5 w-5" />
        </button>
        <h1 className="text-title font-bold">New party</h1>
        <p className="ml-auto text-body text-night-400">Pick a game, choose how you play, then everyone joins.</p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* Game list */}
        <section className="flex min-h-0 flex-col border-r border-night-700 px-4 py-4" aria-labelledby="pick-game">
          <h2 id="pick-game" className="mb-2 text-lead font-bold">
            The game
          </h2>
          <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
            {games === null && !loadErr && (
              <p className="flex items-center gap-3 text-lead text-night-400" role="status">
                <Mark size="1.5rem" spin className="text-night-600" /> Loading games…
              </p>
            )}
            {loadErr && (
              <div className="flex flex-col items-start gap-3 rounded-tile bg-no-deep p-4 ring-1 ring-inset ring-no-dim" role="alert">
                <p className="flex items-center gap-2 text-lead font-bold">
                  <Icon name="warn" className="h-5 w-5 text-no" /> Couldn’t load games
                </p>
                <p className="text-body text-night-200">{loadErr}. Check the engine is running.</p>
                <button type="button" className="btn-secondary min-h-[2.75rem] text-body" onClick={() => setN((x) => x + 1)}>
                  <Icon name="refresh" className="h-4 w-4" /> Try again
                </button>
              </div>
            )}
            {games?.length === 0 && <p className="text-lead text-night-400">No games available. Add a replay or a live feed key to the engine.</p>}
            {groups.map((g) => (
              <div key={g.sport} className="flex flex-col gap-1.5" role="radiogroup" aria-label={SPORT_LABEL[g.sport] ?? g.sport}>
                <h3 className="text-small text-night-400">{SPORT_LABEL[g.sport] ?? g.sport}</h3>
                {g.games.map((x) => {
                  const on = x.id === gameId;
                  return (
                    <button
                      type="button"
                      key={x.id}
                      role="radio"
                      aria-checked={on}
                      onClick={() => setGameId(x.id)}
                      data-testid="game-option"
                      data-game-id={x.id}
                      className={`flex min-h-[4rem] items-center gap-3 rounded-tile px-3 text-left transition-[background-color,box-shadow] duration-quick ease-out active:scale-[0.99] ${
                        on ? 'bg-night-800 ring-2 ring-inset ring-flood' : 'bg-night-900 hover:bg-night-800'
                      }`}
                    >
                      <span className="flex shrink-0 flex-col gap-1" aria-hidden="true">
                        <span className="h-3 w-1.5 rounded-full" style={{ background: x.home.color ?? '#87909B' }} />
                        <span className="h-3 w-1.5 rounded-full" style={{ background: x.away.color ?? '#87909B' }} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="q truncate text-title leading-tight">{x.title}</span>
                        <span className="truncate text-small text-night-400">
                          {x.home.name} vs {x.away.name}
                        </span>
                      </span>
                      <span className={`shrink-0 text-small font-semibold ${x.status === 'live' ? 'text-chalk' : 'text-night-400'}`}>
                        {x.status === 'live' && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-live" aria-hidden="true" />}
                        {STATUS_LABEL[x.status] ?? x.status}
                      </span>
                      {on && <Icon name="check" className="h-6 w-6 shrink-0 text-flood" strokeWidth={2.6} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        {/* Options */}
        <section className="scroll-thin flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
          <div>
            <h2 className="mb-2 text-lead font-bold">How you play</h2>
            <Segmented
              size="lg"
              label="How you play"
              options={(['pool', 'amm', 'bet'] as MarketMode[]).map((m) => ({ value: m, label: MODE_LABEL[m], sub: MODE_BLURB[m] }))}
              value={mode}
              onChange={setMode}
              testIdPrefix="mode"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h2 className="mb-2 text-lead font-bold">Buy-in</h2>
              <Segmented
                label="Buy-in"
                options={[5, 10, 20].map((v) => ({ value: v, label: effSettlement === 'points' ? `${v}\u00a0pts` : `$${v}` }))}
                value={buyIn}
                onChange={setBuyIn}
              />
            </div>
            <div>
              <h2 className="mb-2 text-lead font-bold">Announcer</h2>
              <Segmented
                label="Announcer"
                options={[
                  { value: 'soccer' as Persona, label: 'Soccer' },
                  { value: 'nfl' as Persona, label: 'NFL' },
                  { value: 'calm' as Persona, label: 'Calm' },
                ]}
                value={effPersona}
                onChange={setPersona}
              />
            </div>
          </div>
          <div>
            <h2 className="mb-2 text-lead font-bold">Money</h2>
            <Segmented
              label="Money"
              options={[
                { value: 'points' as SettlementMode, label: 'Points', sub: 'No money at all' },
                { value: 'vault' as SettlementMode, label: 'Vault', sub: 'Test money, paid out automatically' },
                { value: 'trusted' as SettlementMode, label: 'Trusted host', sub: 'The host pays out' },
              ]}
              value={effSettlement}
              onChange={setSettlement}
              testIdPrefix="settlement"
            />
          </div>
          <Toggle on={autoApprove} onChange={setAutoApprove} label="Open AI questions automatically (off: you approve each one)" />
          <div className="mt-auto flex flex-col gap-2 pt-1">
            {err && (
              <p className="flex items-start gap-2 rounded-tile bg-no-deep px-3 py-2 text-body text-chalk ring-1 ring-inset ring-no-dim" role="alert">
                <Icon name="warn" className="mt-0.5 h-5 w-5 shrink-0 text-no" /> {err}
              </p>
            )}
            <button type="button" className="btn-primary min-h-[4rem] text-title" disabled={!game || busy} onClick={() => void create()} data-testid="create-party">
              {busy ? 'Setting up…' : 'Create party'}
              {!busy && <Icon name="arrowRight" className="h-6 w-6" strokeWidth={2.6} />}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
