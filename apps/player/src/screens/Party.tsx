import type { ClientView, Position } from '@huddle/shared';
import { Icon, Kinetic, Mark, Wordmark } from '@huddle/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PartyCtx, type PartyCtxValue } from '../components/ctx';
import { Avatar, Backdrop, InlineError, Loading } from '../components/primitives';
import { getParty, type PartyPreview } from '../lib/api';
import { friendlyError } from '../lib/markets';
import { money } from '../lib/money';
import { useApp, useView, type PartyClient } from '../lib/session';
import { BuyIn } from './BuyIn';
import { CodeTiles } from './Home';
import { Live } from './Live';

/** `/j/CODE`: preview, first-time name, connect, then buy-in or the live screen. */
export function PartyRoute({ code }: { code: string }) {
  const { name, client, partyCode, connect, setName } = useApp();
  const remoteParam = new URLSearchParams(window.location.search).get('r') === '1';
  const [remote, setRemote] = useState(remoteParam);
  const [preview, setPreview] = useState<PartyPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<'missing' | 'offline' | null>(null);
  const [draftName, setDraftName] = useState('');
  const [joining, setJoining] = useState(false);
  const [nameError, setNameError] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const view = useView(partyCode === code.toUpperCase() ? client : null);

  useEffect(() => {
    let alive = true;
    getParty(code)
      .then((p) => alive && setPreview(p))
      .catch((e: { status?: number }) => alive && setPreviewErr(e.status === 404 ? 'missing' : 'offline'));
    return () => {
      alive = false;
    };
  }, [code]);

  // Returning players (name already stored when the page opened) join straight away.
  const [returning] = useState(() => !!name);
  useEffect(() => {
    if (returning && partyCode !== code.toUpperCase() && previewErr !== 'missing') {
      void connect(code, remoteParam);
    }
  }, [returning, code, partyCode, connect, remoteParam, previewErr]);

  if (client && partyCode === code.toUpperCase() && view.snapshot) {
    return <PartyShell client={client} view={view} remote={remoteParam || remote} />;
  }

  const p = preview?.party;
  const players = (preview?.players ?? []).filter((x) => !x.isHouse);
  const joinError = view.lastError ? friendlyError(view.lastError) : null;
  const upper = code.toUpperCase();

  const d = (ms: number) => ({ ['--d' as string]: `${ms}ms` });

  return (
    <div className="relative min-h-[100dvh]">
      <Backdrop />
      <div className="relative z-[1] mx-auto flex min-h-[100dvh] max-w-md flex-col px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+1.25rem)]">
        <header className="flex items-center justify-between">
          <a href="/" className="-m-2 rounded-tile p-2" aria-label="Huddle home">
            <Wordmark className="text-lead text-ink" lit={3} />
          </a>
          <span className="num text-lead tracking-[0.12em] text-ink-muted" translate="no">
            {upper}
          </span>
        </header>

        {previewErr === 'missing' ? (
          <div className="flex flex-1 flex-col justify-center">
            <Mark size="3rem" className="hd-float text-rule-strong" />
            <Kinetic as="h1" text={`No party called ${upper}`} className="q mt-5 block text-head" />
            <p className="hd-rise mt-2 text-pretty text-body text-ink-2" style={d(300)}>
              Check the code on the box with the host, or tap your phone on the box again.
            </p>
            <a href="/" className="btn-secondary mt-6 w-fit">
              <Icon name="arrowLeft" size={18} /> Back home
            </a>
          </div>
        ) : (
          <>
            <section className="mt-8" aria-labelledby="party-name">
              {p ? (
                <>
                  <Kinetic as="h1" id="party-name" text={p.name} className="q block text-[2.5rem] leading-[1] tracking-[-0.04em]" stagger={60} />
                  <div className="hd-rise card mt-5 p-4" style={d(260)}>
                    <p className="flex items-center gap-2 text-small font-semibold text-ink-2">
                      {p.status === 'live' ? (
                        <>
                          <span className="live-dot h-2 w-2 shrink-0 rounded-full bg-hot" aria-hidden="true" /> Live now
                        </>
                      ) : (
                        <>
                          <span className="h-2 w-2 shrink-0 rounded-full bg-zap" aria-hidden="true" /> Starting soon
                        </>
                      )}
                    </p>
                    <p className="mt-1 font-head text-title font-extrabold tracking-[-0.02em] text-ink">{p.game.title}</p>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-cap font-semibold text-ink-muted">Buy-in</p>
                        <p className="num text-title text-ink">{money(p.config.buyIn, p.config.settlement === 'points')}</p>
                      </div>
                      <CodeTiles code={upper} delay={420} />
                    </div>
                  </div>
                </>
              ) : previewErr === 'offline' ? (
                <>
                  <Kinetic as="h1" id="party-name" text={`Party ${upper}`} className="q block text-head" />
                  <p className="mt-2 text-pretty text-small text-ink-muted">Couldn't load the party details. You can still join.</p>
                </>
              ) : (
                <Loading>Finding the party…</Loading>
              )}
            </section>

            {players.length > 0 && (
              <div className="hd-rise mt-5 flex items-center gap-3" style={d(520)}>
                <div className="flex -space-x-2" aria-hidden="true">
                  {players.slice(0, 6).map((pl, i) => (
                    <span key={pl.pubkey} className="hd-pop rounded-[0.8rem] ring-[3px] ring-canvas" style={d(560 + i * 70)}>
                      <Avatar name={pl.name} size="2.25rem" />
                    </span>
                  ))}
                </div>
                <p className="min-w-0 text-small text-ink-2">
                  {players
                    .slice(0, 3)
                    .map((x) => x.name)
                    .join(', ')}
                  {players.length > 3 ? ` and ${players.length - 3} more` : ''} {players.length === 1 ? 'is' : 'are'} in
                </p>
              </div>
            )}

            <div className="mt-auto pt-9">
              {name ? (
                <div className="space-y-3">
                  {!joinError && <Loading className="justify-center">Joining as {name}…</Loading>}
                  {joinError && <InlineError text={joinError} />}
                  {(joinError || view.status === 'reconnecting') && (
                    <button
                      onClick={() => {
                        useApp.getState().disconnect();
                        void connect(code, remoteParam || remote);
                      }}
                      className="btn-primary w-full"
                    >
                      <Icon name="refresh" size={20} /> Try again
                    </button>
                  )}
                </div>
              ) : (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!draftName.trim()) {
                      setNameError(true);
                      nameInput.current?.focus();
                      return;
                    }
                    setJoining(true);
                    await setName(draftName);
                    await connect(code, remote);
                  }}
                  className="hd-rise space-y-3.5"
                  style={d(360)}
                  noValidate
                >
                  <div>
                    <label htmlFor="name" className="block font-head text-lead font-extrabold text-ink">
                      What should the room call you?
                    </label>
                    <input
                      ref={nameInput}
                      id="name"
                      name="nickname"
                      data-testid="join-name"
                      value={draftName}
                      onChange={(e) => {
                        setDraftName(e.target.value);
                        setNameError(false);
                      }}
                      maxLength={24}
                      autoComplete="nickname"
                      autoCapitalize="words"
                      spellCheck={false}
                      enterKeyHint="go"
                      placeholder="Your name…"
                      aria-invalid={nameError}
                      aria-describedby={nameError ? 'name-error' : undefined}
                      className="field mt-2.5 h-14 font-head text-title font-bold"
                    />
                    {nameError && (
                      <p id="name-error" className="hd-rise mt-2 flex items-center gap-2 text-small font-semibold text-hot-600" role="alert">
                        <Icon name="warn" size={16} /> Type a name first, so everyone knows who called it.
                      </p>
                    )}
                  </div>
                  <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-tile bg-card px-4 py-2.5 shadow-lift has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-zap">
                    <input type="checkbox" name="remote" checked={remote} onChange={(e) => setRemote(e.target.checked)} className="peer sr-only" />
                    <span
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-chip bg-card text-transparent ring-2 ring-inset ring-rule-strong transition-[background-color,color,box-shadow,transform] duration-quick peer-checked:scale-110 peer-checked:bg-zap peer-checked:text-white peer-checked:ring-zap"
                      aria-hidden="true"
                    >
                      <Icon name="check" size={16} strokeWidth={3} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-body font-semibold text-ink">I'm watching from somewhere else</span>
                      <span className="block text-cap text-ink-muted">We'll line you up with the room's TV.</span>
                    </span>
                    <Icon name="globe" size={20} className="ml-auto shrink-0 text-zap" />
                  </label>
                  <button type="submit" data-testid="join-submit" disabled={joining} className="btn-prime w-full disabled:bg-prime disabled:text-white">
                    {joining ? (
                      <>
                        <Mark size="1.4rem" spin lit={3} className="text-white/50" /> Joining…
                      </>
                    ) : (
                      'Join the party'
                    )}
                  </button>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Builds the party context and picks buy-in vs. the live screen. */
export function PartyShell({ client, view, remote }: { client: PartyClient; view: ClientView; remote: boolean }) {
  const wallet = useApp((s) => s.wallet);
  const snap = view.snapshot!;
  const me = snap.you?.pubkey ?? wallet?.publicKey ?? '';
  const meP = snap.players.find((p) => p.pubkey === me);
  const [passed, setPassed] = useState(false);
  const balance = snap.you?.state?.balance ?? meP?.balance ?? 0;
  const memory = useRef(new Map<string, Position[]>());
  const positions = useMemo(() => {
    const current = snap.you?.positions ?? [];
    const merged = [...current];
    for (const m of snap.markets) {
      const mine = current.filter((p) => p.marketId === m.id);
      // While a market trades, remember exactly what you hold (a cash-out empties it); once it
      // settles, keep that memory if the engine stops sending the position.
      if (m.state === 'open' || m.state === 'locked') memory.current.set(m.id, mine);
      else if (!mine.length) merged.push(...(memory.current.get(m.id) ?? []));
    }
    return merged;
  }, [snap.you?.positions, snap.markets]);
  const value: PartyCtxValue = useMemo(
    () => ({
      client,
      view,
      snap,
      me,
      meP,
      points: snap.party.config.settlement === 'points',
      balance,
      remote: remote || !!meP?.remote,
      positions,
    }),
    [client, view, snap, me, meP, balance, remote, positions],
  );
  const pass = useCallback(() => setPassed(true), []);
  const open = snap.party.status === 'live' || snap.party.status === 'lobby';
  const unfunded = open && (meP ? meP.deposited === 0 : !snap.you?.state);
  // Once the buy-in screen is up it stays until the player moves on, so the "You're in" confirmation
  // shows after the deposit lands (before, the credit itself unmounted the screen mid-flow).
  const [buyInShown, setBuyInShown] = useState(false);
  useEffect(() => {
    if (unfunded && !passed) setBuyInShown(true);
  }, [unfunded, passed]);
  const needsBuyIn = open && !passed && (unfunded || buyInShown);

  return <PartyCtx.Provider value={value}>{needsBuyIn ? <BuyIn onDone={pass} onSkip={pass} /> : <Live />}</PartyCtx.Provider>;
}
