import type { ClientView } from '@huddle/shared';
import { motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PartyCtx, type PartyCtxValue } from '../components/ctx';
import { Icon, Spinner } from '../components/Icon';
import { InlineError } from '../components/MarketCard';
import { getParty, type PartyPreview } from '../lib/api';
import { friendlyError } from '../lib/markets';
import { money } from '../lib/money';
import { useApp, useView, type PartyClient } from '../lib/session';
import { BuyIn } from './BuyIn';
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

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-6 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+32px)]">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-pitch-400">
        <img src="/icon.svg" alt="" className="h-6 w-6" /> Huddle · party {code.toUpperCase()}
      </div>

      {previewErr === 'missing' ? (
        <div className="mt-10">
          <h1 className="font-display text-4xl font-bold uppercase">Party not found</h1>
          <p className="mt-2 text-pitch-200">Check the code with the host, or tap your phone on the box again.</p>
          <a href="/" className="mt-6 inline-flex min-h-[48px] items-center rounded-2xl bg-pitch-800 px-5 font-semibold">
            Back home
          </a>
        </div>
      ) : (
        <>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-8">
            <h1 className="font-display text-5xl font-bold uppercase leading-[0.95]">{p?.name ?? (previewErr ? 'Watch party' : '…')}</h1>
            {p && (
              <div className="mt-3 flex items-center gap-2 text-lg text-pitch-200">
                <span className="h-2 w-2 rounded-full bg-live" /> {p.game.title}
              </div>
            )}
            {p && (
              <div className="mt-1 text-sm text-pitch-400">
                Buy-in {money(p.config.buyIn, p.config.settlement === 'points')}
              </div>
            )}
          </motion.div>

          {players.length > 0 && (
            <div className="mt-6">
              <div className="flex -space-x-2">
                {players.slice(0, 6).map((pl) => (
                  <span key={pl.pubkey} className="grid h-10 w-10 place-items-center rounded-full border-2 border-pitch-950 bg-pitch-700 font-display text-lg font-bold uppercase">
                    {pl.name.slice(0, 1)}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-sm text-pitch-200">
                {players
                  .slice(0, 3)
                  .map((x) => x.name)
                  .join(', ')}
                {players.length > 3 ? ` +${players.length - 3}` : ''} {players.length === 1 ? 'is' : 'are'} in
              </p>
            </div>
          )}

          <div className="mt-auto pt-10">
            {name ? (
              <div className="space-y-3 text-center">
                <div className="flex items-center justify-center gap-2 text-pitch-200">
                  {joinError ? null : <Spinner />} {joinError ? '' : `Joining as ${name}…`}
                </div>
                {joinError && <InlineError text={joinError} />}
                {(joinError || view.status === 'reconnecting') && (
                  <button
                    onClick={() => {
                      useApp.getState().disconnect();
                      void connect(code, remoteParam || remote);
                    }}
                    className="min-h-[48px] w-full rounded-2xl bg-pitch-800 font-semibold"
                  >
                    Try again
                  </button>
                )}
              </div>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!draftName.trim()) return;
                  setJoining(true);
                  await setName(draftName);
                  await connect(code, remote);
                }}
                className="space-y-3"
              >
                <label htmlFor="name" className="block text-sm text-pitch-200">
                  What should the room call you?
                </label>
                <input
                  id="name"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  maxLength={24}
                  autoComplete="nickname"
                  autoCapitalize="words"
                  enterKeyHint="go"
                  placeholder="Your name"
                  className="h-16 w-full rounded-2xl border border-pitch-700 bg-pitch-900 px-5 font-display text-3xl font-bold text-pitch-50 placeholder:text-pitch-600 focus:border-volt focus:outline-none"
                />
                <label className="flex min-h-[44px] items-center gap-3 text-sm text-pitch-200">
                  <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} className="h-5 w-5 accent-[#D4FF3A]" />
                  <span className="flex items-center gap-1.5">
                    <Icon name="globe" size={16} className="text-gemini" /> I'm watching from somewhere else
                  </span>
                </label>
                <button
                  type="submit"
                  disabled={!draftName.trim() || joining}
                  className="flex min-h-[64px] w-full items-center justify-center rounded-2xl bg-volt font-display text-2xl font-bold uppercase tracking-wide text-volt-ink shadow-glow transition-opacity disabled:opacity-40"
                >
                  {joining ? <Spinner size={24} /> : 'Join the party'}
                </button>
              </form>
            )}
          </div>
        </>
      )}
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
  const value: PartyCtxValue = useMemo(
    () => ({ client, view, snap, me, meP, points: snap.party.config.settlement === 'points', balance, remote: remote || !!meP?.remote }),
    [client, view, snap, me, meP, balance, remote],
  );
  const pass = useCallback(() => setPassed(true), []);
  const open = snap.party.status === 'live' || snap.party.status === 'lobby';
  const needsBuyIn = open && !passed && (meP ? meP.deposited === 0 : !snap.you?.state);

  return <PartyCtx.Provider value={value}>{needsBuyIn ? <BuyIn onDone={pass} onSkip={pass} /> : <Live />}</PartyCtx.Provider>;
}
