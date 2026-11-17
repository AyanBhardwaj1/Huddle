import type { GameInfo, MarketMode, Persona, SettlementMode } from '@huddle/shared';
import { useEffect, useMemo, useState } from 'react';
import { Icon, Segmented, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { groupGames, MODE_BLURB, MODE_LABEL, personaForSport } from '../lib/derive';
import { providerName } from '../lib/health';
import { useBox } from '../store';
import { useHealth } from './Home';

const SPORT_LABEL: Record<string, string> = { soccer: 'Soccer', nfl: 'NFL' };

export function CreateParty() {
  const setScreen = useBox((s) => s.setScreen);
  const setSession = useBox((s) => s.setSession);
  const { health } = useHealth(15000);
  const [games, setGames] = useState<GameInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [mode, setMode] = useState<MarketMode>('pool');
  const [buyIn, setBuyIn] = useState(10);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [settlement, setSettlement] = useState<SettlementMode | null>(null);
  const [autoApprove, setAutoApprove] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .games()
      .then((g) => {
        setGames(g);
        setGameId((cur) => cur ?? g.find((x) => x.status === 'replay')?.id ?? g[0]?.id ?? null);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  // Default the settlement chip to what the engine runs with.
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
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <button className="btn-ghost min-h-[2.75rem] px-3" onClick={() => setScreen('home')} aria-label="Back">
          <Icon name="next" className="h-5 w-5 rotate-180" />
        </button>
        <h1 className="font-display text-[2.4rem] font-bold uppercase leading-none tracking-wide">New party</h1>
        {err && (
          <span className="ml-auto flex items-center gap-2 rounded-full bg-down/15 px-3 py-1 text-[0.95rem] text-down ring-1 ring-down/60">
            <Icon name="warn" className="h-4 w-4" /> {err}
          </span>
        )}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_1.25fr] gap-4">
        {/* Game list */}
        <section className="card flex min-h-0 flex-col p-3">
          <h2 className="kicker mb-2">1 · Pick the game</h2>
          <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
            {games === null && !err && <div className="text-pitch-400">Loading games…</div>}
            {games?.length === 0 && <div className="text-pitch-400">No games available.</div>}
            {groups.map((g) => (
              <div key={g.sport} className="flex flex-col gap-2">
                <div className="text-[0.8rem] font-bold uppercase tracking-[0.2em] text-pitch-400">{SPORT_LABEL[g.sport] ?? g.sport}</div>
                {g.games.map((x) => {
                  const on = x.id === gameId;
                  return (
                    <button
                      key={x.id}
                      onClick={() => setGameId(x.id)}
                      data-testid="game-option"
                      data-game-id={x.id}
                      className={`flex min-h-[3.6rem] items-center gap-3 rounded-xl px-3 text-left ring-1 transition active:scale-[0.99] ${on ? 'bg-volt/10 ring-2 ring-volt' : 'bg-pitch-800 ring-pitch-700'}`}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-display text-[1.45rem] font-semibold leading-tight">{x.title}</span>
                        <span className="text-[0.8rem] text-pitch-400">
                          {x.home.name} vs {x.away.name}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-widest ${
                          x.status === 'live'
                            ? 'bg-live text-white'
                            : x.status === 'replay'
                              ? 'bg-pitch-600 text-pitch-50'
                              : 'bg-pitch-700 text-pitch-200'
                        }`}
                      >
                        {x.status}
                      </span>
                      {on && <Icon name="check" className="h-6 w-6 shrink-0 text-volt" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        {/* Options */}
        <section className="flex min-h-0 flex-col gap-2.5">
          <div>
            <h2 className="kicker mb-1.5">2 · How you play</h2>
            <Segmented
              size="lg"
              options={(['bet', 'pool', 'amm'] as MarketMode[]).map((m) => ({ value: m, label: MODE_LABEL[m], sub: MODE_BLURB[m] }))}
              value={mode}
              onChange={setMode}
              testIdPrefix="mode"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <h2 className="kicker mb-1.5">Buy-in</h2>
              <Segmented
                options={[5, 10, 20].map((v) => ({ value: v, label: effSettlement === 'points' ? `${v} pts` : `$${v}` }))}
                value={buyIn}
                onChange={setBuyIn}
              />
            </div>
            <div>
              <h2 className="kicker mb-1.5">Announcer</h2>
              <Segmented
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
            <h2 className="kicker mb-1.5">Money</h2>
            <Segmented
              options={[
                { value: 'vault' as SettlementMode, label: 'Vault', sub: 'Test money, paid out automatically' },
                { value: 'trusted' as SettlementMode, label: 'Trusted host', sub: 'Host pays out' },
                { value: 'points' as SettlementMode, label: 'Points', sub: 'No money at all' },
              ]}
              value={effSettlement}
              onChange={setSettlement}
              testIdPrefix="settlement"
            />
          </div>
          <Toggle on={autoApprove} onChange={setAutoApprove} label="Open AI questions automatically (off = you approve each one)" />
          <button className="btn-volt mt-auto min-h-[4.2rem] text-[2rem]" disabled={!game || busy} onClick={() => void create()} data-testid="create-party">
            {busy ? 'Setting up…' : 'Create party'}
            {!busy && <Icon name="next" className="h-7 w-7" />}
          </button>
        </section>
      </div>
    </div>
  );
}
