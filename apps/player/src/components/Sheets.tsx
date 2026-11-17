import type { DraftBet } from '@huddle/shared';
import { Icon, Kinetic } from '@huddle/ui';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { requestFaucet } from '../lib/api';
import { buzz, HAPTIC } from '../lib/haptics';
import { friendlyError } from '../lib/markets';
import { money, moneyShort } from '../lib/money';
import type { PartyClient } from '../lib/session';
import { act, cx, useNow, useParty, useUi } from './ctx';
import { delayText } from './Header';
import { useNotify } from './MarketCard';
import { InlineError, Money, Sheet } from './primitives';
import { tone } from './tones';

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
  // Drafts you waved off after their question locked (the engine keeps them until they expire).
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const draft: DraftBet | undefined = (snap.you?.drafts ?? []).find((d) => Date.parse(d.expiresAt) > now && !gone.has(d.id));
  const market = draft ? snap.markets.find((m) => m.id === draft.marketId) : undefined;
  const idx = market?.outcomes.findIndex((o) => o.id === draft?.outcome) ?? 0;
  const t = tone(idx, market?.outcomes.length ?? 2);
  const label = market?.outcomes[idx]?.label ?? draft?.outcome ?? '';
  const total = draft ? Math.max(1, Date.parse(draft.expiresAt) - Date.parse(draft.createdAt)) : 1;
  const left = draft ? Math.max(0, Date.parse(draft.expiresAt) - now) : 0;
  const closed = !!market && market.state !== 'open';

  const run = async (kind: 'confirm' | 'reject') => {
    if (!draft) return;
    if (kind === 'reject' && closed) {
      // Nothing can be placed any more: drop it here, and tell the engine without waiting.
      setGone((g) => new Set(g).add(draft.id));
      setError(null);
      void client.request({ type: 'reject_draft', draftId: draft.id }).catch(() => {});
      return;
    }
    setBusy(kind);
    setError(null);
    const err = await act(client, kind === 'confirm' ? { type: 'confirm_draft', draftId: draft.id } : { type: 'reject_draft', draftId: draft.id });
    setBusy(null);
    if (err) return setError(err);
    if (kind === 'confirm') notify(`${moneyShort(draft.amount, points)} on ${label}. Locked in.`, 'win');
  };

  return (
    <Sheet open={!!draft} onClose={() => run('reject')} dismissable={busy === null} label="Confirm your bet">
      {draft && (
        <div className="pb-1 pt-1">
          <p className="flex items-center gap-2 text-small text-ink-2">
            <span className="hd-pop grid h-9 w-9 place-items-center rounded-full bg-prime text-white shadow-zap">
              <Icon name="mic" size={18} />
            </span>
            {draft.source === 'voice' ? 'The announcer drafted a bet for you' : 'The host drafted a bet for you'}
          </p>
          <p className="hd-stamp mt-4 flex flex-wrap items-baseline gap-x-2 leading-none">
            <span className="num text-display">{money(draft.amount, points)}</span> <span className="font-head text-title font-bold text-ink-muted">on</span>{' '}
            <span className={cx('rounded-tile px-3 py-1 font-head text-head font-extrabold', t.solid, t.ink)}>{label}</span>
          </p>
          {market && <Kinetic as="p" text={market.question} className="q mt-3 block text-lead text-ink-2" delay={200} stagger={30} />}
          {closed ? (
            <p className="mt-5 flex items-center gap-2 rounded-tile bg-canvas px-3.5 py-3 text-small text-ink-2">
              <Icon name="lock" size={18} className="shrink-0 text-ink-muted" /> This question locked before you confirmed, so nothing was placed.
            </p>
          ) : (
            <>
              <DrainBar key={draft.id} from={left / total} ms={left} />
              <p className="mt-1.5 text-cap text-ink-muted tnum">Expires in {Math.ceil(left / 1000)}&nbsp;s. Nothing moves until you confirm.</p>
            </>
          )}
          {closed ? (
            <button onClick={() => run('reject')} className="btn-secondary mt-5 min-h-14 w-full">
              Got it
            </button>
          ) : (
          <div className="mt-5 grid grid-cols-[1fr_1.6fr] gap-3">
            <button disabled={busy !== null} onClick={() => run('reject')} className="btn-secondary min-h-14">
              {busy === 'reject' ? 'Cancelling…' : 'Cancel'}
            </button>
            <button disabled={busy !== null} onClick={() => run('confirm')} className="btn-prime">
              {busy === 'confirm' ? 'Confirming…' : `Confirm ${moneyShort(draft.amount, points)}`}
            </button>
          </div>
          )}
          {error && !closed && <InlineError text={error} />}
        </div>
      )}
    </Sheet>
  );
}

/** A bar that drains to zero over `ms` (values frozen at mount so re-renders never restart it). */
function DrainBar({ from, ms }: { from: number; ms: number }) {
  const [style] = useState(() => ({ '--from': from, '--dur': `${ms}ms` }) as CSSProperties);
  return (
    <div className="mt-5 h-1 overflow-hidden rounded-full bg-rule" aria-hidden="true">
      <div className="pl-drain h-full bg-zap" style={style} />
    </div>
  );
}

/** Your balance in three numbers, and a top-up up to the host's max buy-in. */
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
      <div className="space-y-5">
        <dl className="grid grid-cols-3 divide-x divide-rule rounded-tile bg-canvas py-3">
          <Mini label="Available">
            <Money value={balance} points={points} />
          </Mini>
          <Mini label="In play">
            <Money value={meP?.locked ?? 0} points={points} />
          </Mini>
          <Mini label="Bought in">
            <Money value={deposited} points={points} />
          </Mini>
        </dl>
        {ended ? (
          <p className="text-small text-ink-muted">The game is over, so there are no more top-ups.</p>
        ) : amount > 0 ? (
          <>
            <button disabled={step !== 'idle'} onClick={go} className="btn-prime w-full disabled:bg-prime disabled:text-white">
              {step === 'idle' ? `Add ${moneyShort(amount, points)}` : step === 'funding' ? 'Getting your chips…' : 'Adding…'}
            </button>
            <p className="text-center text-cap text-ink-muted">
              Up to {money(cfg.maxBuyIn, points)} per player tonight. {money(room, points)} left.
            </p>
          </>
        ) : (
          <p className="text-small text-ink-muted">You're at the host's max buy-in for tonight ({money(cfg.maxBuyIn, points)}).</p>
        )}
        {error && <InlineError text={error} />}
      </div>
    </Sheet>
  );
}

function Mini({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-3 text-center">
      <dt className="text-cap text-ink-muted">{label}</dt>
      <dd className="num text-title">{children}</dd>
    </div>
  );
}

/** Remote sync check (PRD section 12): tap the moment you see kickoff or the snap. */
export function SyncCheck() {
  const { client, snap } = useParty();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const delay = snap.you?.delayMs;
  const [expanded, setExpanded] = useState(delay == null);
  const nfl = snap.game.sport === 'nfl';
  const moment = nfl ? 'the next snap' : snap.game.status === 'pre' ? 'kickoff' : 'the next kickoff or restart';

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
      <div className="hd-rise flex items-center justify-between gap-3 rounded-full bg-card py-1 pl-4 pr-1.5 shadow-lift">
        <span className="flex items-center gap-2 text-small font-semibold text-ink-2">
          <Icon name="globe" size={18} className="text-zap" />
          {Math.abs(delay) < 3000 ? "You're in sync with the room" : `You're about ${delayText(delay)}`}
        </span>
        <button onClick={() => setExpanded(true)} className="btn-quiet rounded-full text-small">
          Sync again
        </button>
      </div>
    );

  return (
    <section className="hd-rise card relative overflow-hidden p-4" aria-labelledby="sync-title">
      <div className="absolute inset-x-0 top-0 h-1 bg-prime" aria-hidden="true" />
      <div className="flex items-start gap-3">
        <span className="hd-float grid h-11 w-11 shrink-0 place-items-center rounded-tile bg-zap-100 text-zap-deep">
          <Icon name="globe" size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="sync-title" className="q text-lead">
            {delay == null ? 'Watching on a stream?' : 'Sync with the room again'}
          </h2>
          <p className="mt-0.5 text-pretty text-small text-ink-2">
            Tap the button the moment you see {moment}. We line you up with the room's TV so nobody bets on what they've already seen.
          </p>
        </div>
      </div>
      <button disabled={busy} onClick={mark} className="btn-primary mt-4 w-full">
        {busy ? 'Lining you up…' : `I see ${nfl ? 'the snap' : 'it'}!`}
      </button>
      {error && <InlineError text={error} />}
    </section>
  );
}
