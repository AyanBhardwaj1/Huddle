import { Burst, Icon, Kinetic, Mark, Roll, Wordmark } from '@huddle/ui';
import { useEffect, useRef, useState } from 'react';
import { useParty } from '../components/ctx';
import { Avatar, Backdrop, InlineError, useCoins } from '../components/primitives';
import { buyInFlow } from '../components/Sheets';
import { buzz, HAPTIC } from '../lib/haptics';
import { friendlyError } from '../lib/markets';
import { money, moneyShort } from '../lib/money';
import { useApp } from '../lib/session';

type Step = 'idle' | 'funding' | 'depositing' | 'done';

const d = (ms: number) => ({ ['--d' as string]: `${ms}ms` });

/**
 * One big "Buy in 10 pts", then "You're in": gold coins arc from the button into the room's pot
 * while it rolls up (money-flow), and a small gold burst lands on the pot. The confirmation stays
 * mounted until the player moves on (or 2.2 s pass), even though the deposit has landed by then.
 */
export function BuyIn({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const { client, snap, points, me } = useParty();
  const wallet = useApp((s) => s.wallet?.publicKey ?? null);
  const name = useApp((s) => s.name);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const amount = Math.min(snap.party.config.buyIn, snap.party.config.maxBuyIn);
  const players = snap.players.filter((p) => !p.isHouse);
  const inPlayers = players.filter((p) => p.deposited > 0);
  const others = inPlayers.filter((p) => p.pubkey !== me);
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
      fire(button.current, potEl.current, 3);
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
    <div className="relative min-h-[100dvh]">
      <Backdrop />
      <div className="relative z-[1] mx-auto flex min-h-[100dvh] max-w-md flex-col px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+1.25rem)]">
        <header className="flex items-center justify-between">
          <Wordmark className="text-lead text-ink" lit={3} />
          <span className="num text-lead tracking-[0.12em] text-ink-muted" translate="no">
            {snap.party.code}
          </span>
        </header>

        <div className="mt-8">
          <p className="hd-fade text-small font-semibold text-ink-muted">{snap.party.name}</p>
          <Kinetic as="h1" text={snap.party.game.title} className="q mt-1 block text-head" stagger={50} />
        </div>

        <div className="flex flex-1 flex-col justify-center py-8">
          {done ? (
            <div key="done" data-testid="buy-in-done" role="status" className="hd-zoom card relative overflow-visible p-5">
              <span className="hd-pop grid h-14 w-14 place-items-center rounded-full bg-prime text-white shadow-zap">
                <Icon name="check" size={30} strokeWidth={2.8} />
              </span>
              <Kinetic text={`You're in${name ? `, ${name}` : ''}.`} as="p" className="q mt-4 block text-[2.5rem] leading-[1] tracking-[-0.04em]" delay={120} stagger={70} />
              <p className="hd-rise mt-2 text-body text-ink-2" style={d(420)}>
                <span className="num text-ink">{money(amount, points)}</span> ready to play. The first question drops on the next big moment.
              </p>
            </div>
          ) : (
            <div key="cta">
              <p className="hd-zoom num bg-prime bg-clip-text text-[6.5rem] leading-[0.9] text-transparent">{moneyShort(amount, points)}</p>
              <p className="hd-rise mt-2 font-head text-title font-extrabold tracking-[-0.02em] text-ink" style={d(160)}>
                {points ? 'in points to play tonight' : 'to play tonight'}
              </p>
            </div>
          )}

          <div className="hd-rise card mt-6 flex items-center gap-3 px-4 py-3" style={d(260)}>
            <div className="flex -space-x-2" aria-hidden="true">
              {inPlayers.slice(0, 5).map((p, i) => (
                <span key={p.pubkey} className="hd-pop rounded-[0.75rem] ring-[3px] ring-card" style={d(300 + i * 70)}>
                  <Avatar name={p.name} size="2rem" />
                </span>
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
            <span className="relative shrink-0 text-right">
              <span className="flex items-center justify-end gap-1 text-cap font-semibold text-ink-muted">
                <span className="h-2 w-2 rounded-full bg-gold" aria-hidden="true" /> Room pot
              </span>
              <span ref={potEl} className="num text-title text-ink">
                <Roll text={money(pot, points)} value={pot} duration={900} />
              </span>
              {done && <Burst count={14} seed={7} colours={['#FFB020', '#FFC83D', '#FF2E93', '#6C2BFF']} x="70%" y="60%" spread={6} delay={700} />}
            </span>
          </div>
        </div>

        {done ? (
          <button onClick={onDone} className="btn-primary w-full">
            Let's go <Icon name="arrowRight" size={20} />
          </button>
        ) : (
          <>
            <button ref={button} disabled={working} onClick={go} data-testid="buy-in" className="btn-prime w-full disabled:bg-prime disabled:text-white">
              {working ? (
                <>
                  <Mark size="1.4rem" spin lit={3} className="text-white/50" />
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
    </div>
  );
}
