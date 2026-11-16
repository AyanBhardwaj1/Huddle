import type { DraftBet } from '@huddle/shared';
import { useState } from 'react';
import { requestFaucet } from '../lib/api';
import { buzz, HAPTIC } from '../lib/haptics';
import { friendlyError } from '../lib/markets';
import { money, moneyShort } from '../lib/money';
import type { PartyClient } from '../lib/session';
import { act, cx, useNow, useParty, useUi } from './ctx';
import { Icon, Spinner } from './Icon';
import { InlineError, toneFor, useNotify } from './MarketCard';
import { Sheet } from './primitives';

/** Faucet (devnet test funds; no-op in points mode), then the buy-in round trip. */
export async function buyInFlow(
  client: PartyClient,
  wallet: string | null,
  amount: number,
  onStep?: (s: 'funding' | 'depositing') => void,
): Promise<void> {
  onStep?.('funding');
  if (wallet) await requestFaucet(wallet);
  onStep?.('depositing');
  await client.buyIn(amount);
}

/** Voice-created draft bet: one-tap confirm (PRD section 7, the voice path never moves money). */
export function DraftSheet() {
  const { client, snap, points } = useParty();
  const notify = useNotify();
  const now = useNow(1000);
  const [busy, setBusy] = useState<'confirm' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draft: DraftBet | undefined = (snap.you?.drafts ?? []).find((d) => Date.parse(d.expiresAt) > now);
  const market = draft ? snap.markets.find((m) => m.id === draft.marketId) : undefined;
  const idx = market?.outcomes.findIndex((o) => o.id === draft?.outcome) ?? 0;
  const label = market?.outcomes[idx]?.label ?? draft?.outcome ?? '';

  const run = async (kind: 'confirm' | 'reject') => {
    if (!draft) return;
    setBusy(kind);
    setError(null);
    const err = await act(client, kind === 'confirm' ? { type: 'confirm_draft', draftId: draft.id } : { type: 'reject_draft', draftId: draft.id });
    setBusy(null);
    if (err) return setError(err);
    if (kind === 'confirm') notify(`${moneyShort(draft.amount, points)} on ${label}. Locked in.`, 'win');
  };

  return (
    <Sheet open={!!draft} onClose={() => run('reject')} dismissable={busy === null}>
      {draft && (
        <div className="space-y-4 pt-1 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-volt/15 text-volt">
            <Icon name="mic" size={26} />
          </div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-pitch-400">
            {draft.source === 'voice' ? 'The announcer drafted a bet for you' : 'The host drafted a bet for you'}
          </div>
          <div className="font-display text-5xl font-bold leading-none">
            <span className="tnum">{money(draft.amount, points)}</span> <span className="text-pitch-400">on</span>{' '}
            <span className={toneFor(idx).text}>{label}</span>
          </div>
          {market && <p className="text-pitch-200">{market.question}</p>}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              disabled={busy !== null}
              onClick={() => run('reject')}
              className="min-h-[56px] rounded-2xl bg-pitch-800 font-display text-xl font-bold uppercase text-pitch-200 active:scale-[0.98]"
            >
              {busy === 'reject' ? <Spinner /> : 'Cancel'}
            </button>
            <button
              disabled={busy !== null}
              onClick={() => run('confirm')}
              className="flex min-h-[56px] items-center justify-center rounded-2xl bg-volt font-display text-xl font-bold uppercase text-volt-ink shadow-glow active:scale-[0.98]"
            >
              {busy === 'confirm' ? <Spinner /> : 'Confirm'}
            </button>
          </div>
          <div className="text-xs text-pitch-400 tnum">Expires in {Math.max(0, Math.ceil((Date.parse(draft.expiresAt) - now) / 1000))} s</div>
          {error && <InlineError text={error} />}
        </div>
      )}
    </Sheet>
  );
}

/** Top up until the host's max buy-in. */
export function TopUpSheet({ wallet }: { wallet: string | null }) {
  const { client, snap, meP, balance, points } = useParty();
  const open = useUi((s) => s.topUpOpen);
  const setOpen = useUi((s) => s.setTopUp);
  const notify = useNotify();
  const [step, setStep] = useState<'idle' | 'funding' | 'depositing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const cfg = snap.party.config;
  const deposited = meP?.deposited ?? 0;
  const room = Math.max(0, cfg.maxBuyIn - deposited);
  const amount = Math.min(cfg.buyIn, room);
  const ended = snap.party.status !== 'live' && snap.party.status !== 'lobby';

  const go = async () => {
    setError(null);
    try {
      await buyInFlow(client, wallet, amount, setStep);
      buzz(HAPTIC.success);
      notify(`Added ${money(amount, points)}`, 'win');
      setOpen(false);
    } catch (e) {
      buzz(HAPTIC.error);
      setError(friendlyError(e));
    } finally {
      setStep('idle');
    }
  };

  return (
    <Sheet open={open} onClose={() => step === 'idle' && setOpen(false)} title="Your balance">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Mini label="Available" value={money(balance, points)} />
          <Mini label="In play" value={money(meP?.locked ?? 0, points)} />
          <Mini label="Bought in" value={money(deposited, points)} />
        </div>
        {ended ? (
          <p className="text-sm text-pitch-400">The game is over, no more top-ups.</p>
        ) : amount > 0 ? (
          <>
            <button
              disabled={step !== 'idle'}
              onClick={go}
              className="flex min-h-[60px] w-full items-center justify-center gap-2 rounded-2xl bg-volt font-display text-2xl font-bold uppercase tracking-wide text-volt-ink shadow-glow active:scale-[0.98] disabled:opacity-70"
            >
              {step === 'idle' ? `Add ${moneyShort(amount, points)}` : <><Spinner /> {step === 'funding' ? 'Getting chips…' : 'Adding…'}</>}
            </button>
            <p className="text-center text-xs text-pitch-400">
              Up to {money(cfg.maxBuyIn, points)} per player tonight · {money(room, points)} left
            </p>
          </>
        ) : (
          <p className="text-sm text-pitch-400">You're at the host's max buy-in for tonight ({money(cfg.maxBuyIn, points)}).</p>
        )}
        {error && <InlineError text={error} />}
      </div>
    </Sheet>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-pitch-800 px-2 py-3">
      <div className="font-display text-xl font-bold tnum">{value}</div>
      <div className="text-[11px] text-pitch-400">{label}</div>
    </div>
  );
}

/** Remote sync check (PRD section 12): tap when you see kickoff / the next snap. */
export function SyncCheck() {
  const { client, snap } = useParty();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const delay = snap.you?.delayMs;
  const [expanded, setExpanded] = useState(delay == null);
  const moment = snap.game.sport === 'nfl' ? 'the next snap' : snap.game.status === 'pre' ? 'kickoff' : 'the next kickoff or restart';

  const mark = async () => {
    setBusy(true);
    setError(null);
    const err = await act(client, { type: 'sync_mark', clientTs: client.now() });
    setBusy(false);
    if (err) setError(err);
    else setExpanded(false);
  };

  if (delay != null && !expanded)
    return (
      <div className="flex items-center justify-between rounded-2xl bg-gemini/10 px-4 py-2 text-sm">
        <span className="flex items-center gap-2 text-gemini">
          <Icon name="globe" size={16} />
          {Math.abs(delay) < 3000
            ? "You're in sync with the room"
            : `You're about ${Math.round(Math.abs(delay) / 1000)} s ${delay > 0 ? 'behind' : 'ahead of'} the room`}
        </span>
        <button onClick={() => setExpanded(true)} className="min-h-[44px] px-2 font-semibold text-pitch-200">
          Re-sync
        </button>
      </div>
    );

  return (
    <div className="rounded-card border border-gemini/30 bg-gemini/10 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gemini/20 text-gemini">
          <Icon name="globe" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-pitch-50">{delay == null ? 'Watching on a stream?' : 'Re-sync with the room'}</div>
          <p className="text-sm text-pitch-200">Tap the button the moment you see {moment} so we can line you up with the room's TV.</p>
        </div>
      </div>
      <button
        disabled={busy}
        onClick={mark}
        className={cx('mt-3 flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-gemini font-display text-xl font-bold uppercase tracking-wide text-pitch-950 active:scale-[0.98]')}
      >
        {busy ? <Spinner /> : `I see ${snap.game.sport === 'nfl' ? 'the snap' : 'it'}!`}
      </button>
      {error && <InlineError text={error} />}
    </div>
  );
}
