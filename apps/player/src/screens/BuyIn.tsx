import { Icon, Mark, Roll, Wordmark } from '@huddle/ui';
import { useEffect, useRef, useState } from 'react';
import { useParty } from '../components/ctx';
import { Avatar, InlineError, useCoins } from '../components/primitives';
import { buyInFlow } from '../components/Sheets';
import { buzz, HAPTIC } from '../lib/haptics';
import { friendlyError } from '../lib/markets';
import { money, moneyShort } from '../lib/money';
import { useApp } from '../lib/session';

type Step = 'idle' | 'funding' | 'depositing' | 'done';

/**
 * One big "Buy in $10", then "You're in": coins travel from you into the room's pot while it rolls
 * up (money-flow). The confirmation stays mounted until the player moves on (or 2.2 s pass), even
 * though the deposit itself has already landed by then.
 */
export function BuyIn({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const { client, snap, points, me } = useParty();
  const wallet = useApp((s) => s.wallet?.publicKey ?? null);
  const name = useApp((s) => s.name);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const amount = Math.min(snap.party.config.buyIn, snap.party.config.maxBuyIn);
  const players = snap.players.filter((p) => !p.isHouse);
  const others = players.filter((p) => p.deposited > 0 && p.pubkey !== me);
  const pot = players.reduce((a, p) => a + p.deposited, 0);
  const button = useRef<HTMLButtonElement>(null);
  const potEl = useRef<HTMLSpanElement>(null);
  const [coins, fire] = useCoins();

  useEffect(() => {
    if (step !== 'done') return;
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [step, onDone]);

  const go = async () => {
    setError(null);
    buzz(HAPTIC.tap);
    try {
      await buyInFlow(client, wallet, amount, setStep);
      buzz(HAPTIC.win);
      fire(button.current, potEl.current, 7);
      setStep('done');
    } catch (e) {
      buzz(HAPTIC.error);
      setError(friendlyError(e));
      setStep('idle');
    }
  };

  const done = step === 'done';
  const working = step === 'funding' || step === 'depositing';

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+1.25rem)]">
      <header className="flex items-center justify-between">
        <Wordmark className="text-lead text-ink-2" />
        <span className="font-display text-small font-bold stretch-wide text-ink-muted" translate="no">
          {snap.party.code}
        </span>
      </header>

      <div className="mt-10">
        <p className="text-small text-ink-muted">{snap.party.name}</p>
        <h1 className="mt-1 text-balance font-display text-head font-extrabold stretch-semi">{snap.party.game.title}</h1>
      </div>

      <div className="flex flex-1 flex-col justify-center py-8">
        {done ? (
          <div key="done" data-testid="buy-in-done" role="status">
            <span className="hd-pop grid h-14 w-14 place-items-center rounded-full bg-zap text-zap-ink">
              <Icon name="check" size={30} strokeWidth={2.8} />
            </span>
            <p className="hd-stamp mt-5 font-display text-display font-black stretch-condensed" style={{ ['--d' as string]: '120ms' }}>
              You're in{name ? `, ${name}` : ''}.
            </p>
            <p className="hd-rise mt-2 text-lead text-ink-2" style={{ ['--d' as string]: '260ms' }}>
              <span className="font-display font-bold text-ink tnum">{money(amount, points)}</span> ready to play. First question drops on the next big
              moment.
            </p>
          </div>
        ) : (
          <div key="cta">
            <p className="font-display text-hero font-black leading-none stretch-condensed tnum">{moneyShort(amount, points)}</p>
            <p className="mt-2 text-lead text-ink-2">{points ? 'in points to play tonight' : 'to play tonight'}</p>
          </div>
        )}

        <div className="mt-8 flex items-center gap-3 border-t border-rule pt-4">
          <div className="flex -space-x-1.5" aria-hidden="true">
            {players.filter((p) => p.deposited > 0).slice(0, 5).map((p) => (
              <Avatar key={p.pubkey} name={p.name} className="h-8 w-8 ring-2 ring-card" />
            ))}
          </div>
          <p className="min-w-0 flex-1 text-small text-ink-2">
            {others.length === 0
              ? 'Be the first one in.'
              : `${others
                  .slice(0, 2)
                  .map((p) => p.name)
                  .join(', ')}${others.length > 2 ? ` and ${others.length - 2} more` : ''} ${others.length === 1 ? 'is' : 'are'} in.`}
          </p>
          <span className="shrink-0 text-right">
            <span className="block text-cap text-ink-muted">Room pot</span>
            <span ref={potEl} className="font-display text-lead font-extrabold stretch-condensed">
              <Roll text={money(pot, points)} value={pot} />
            </span>
          </span>
        </div>
      </div>

      {done ? (
        <button onClick={onDone} className="btn-primary w-full shadow-zap">
          Let's go <Icon name="arrowRight" size={20} />
        </button>
      ) : (
        <>
          <button ref={button} disabled={working} onClick={go} data-testid="buy-in" className="btn-primary w-full shadow-zap disabled:bg-zap disabled:text-zap-ink">
            {working ? (
              <>
                <Mark size="1.4rem" spin />
                {step === 'funding' ? 'Getting your chips…' : 'Locking it in…'}
              </>
            ) : (
              `Buy in ${moneyShort(amount, points)}`
            )}
          </button>
          {error && <InlineError text={error} />}
          <p className="mt-3 text-pretty text-center text-cap text-ink-muted">
            {points
              ? 'Points only tonight. No money involved.'
              : 'Test money only, nothing real. Your winnings are paid out automatically after the game.'}
          </p>
          <button onClick={onSkip} className="btn-quiet mx-auto mt-1 flex text-small">
            Just watch for now
          </button>
        </>
      )}
      {coins}
    </div>
  );
}
