import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useParty } from '../components/ctx';
import { Icon, Spinner } from '../components/Icon';
import { InlineError } from '../components/MarketCard';
import { Confetti } from '../components/primitives';
import { buyInFlow } from '../components/Sheets';
import { buzz, HAPTIC } from '../lib/haptics';
import { friendlyError } from '../lib/markets';
import { money, moneyShort } from '../lib/money';
import { useApp } from '../lib/session';

type Step = 'idle' | 'funding' | 'depositing' | 'done';

/** One big "Buy in $10" button, progress, then a celebration (PRD Flow B). */
export function BuyIn({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const { client, snap, points } = useParty();
  const wallet = useApp((s) => s.wallet?.publicKey ?? null);
  const name = useApp((s) => s.name);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const amount = Math.min(snap.party.config.buyIn, snap.party.config.maxBuyIn);
  const others = snap.players.filter((p) => !p.isHouse && p.deposited > 0);

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
      setStep('done');
    } catch (e) {
      buzz(HAPTIC.error);
      setError(friendlyError(e));
      setStep('idle');
    }
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-6 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+28px)]">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-pitch-400">{snap.party.name}</div>
      <h1 className="mt-1 font-display text-4xl font-bold uppercase leading-none">{snap.party.game.title}</h1>
      {others.length > 0 && (
        <p className="mt-3 text-sm text-pitch-200">
          {others
            .slice(0, 3)
            .map((p) => p.name)
            .join(', ')}
          {others.length > 3 ? ` and ${others.length - 3} more are` : others.length === 1 ? ' is' : ' are'} already in.
        </p>
      )}

      <div className="relative flex flex-1 flex-col items-center justify-center py-10 text-center">
        <AnimatePresence mode="wait">
          {step === 'done' ? (
            <motion.div key="done" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative">
              <Confetti count={36} />
              <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-volt text-volt-ink shadow-glow">
                <Icon name="check" size={48} />
              </div>
              <div className="mt-6 font-display text-5xl font-bold uppercase">You're in{name ? `, ${name}` : ''}!</div>
              <div className="mt-2 text-lg text-pitch-200">
                <span className="tnum font-semibold text-pitch-50">{money(amount, points)}</span> ready to play
              </div>
            </motion.div>
          ) : (
            <motion.div key="cta" exit={{ opacity: 0, scale: 0.95 }}>
              <div className="font-display text-[96px] font-bold leading-none text-volt tnum">{moneyShort(amount, points)}</div>
              <div className="mt-2 text-pitch-200">to play tonight</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {step === 'done' ? (
        <button onClick={onDone} className="min-h-[64px] w-full rounded-2xl bg-volt font-display text-2xl font-bold uppercase tracking-wide text-volt-ink shadow-glow">
          Let's go
        </button>
      ) : (
        <>
          <button
            disabled={step !== 'idle'}
            onClick={go}
            className="flex min-h-[68px] w-full items-center justify-center gap-3 rounded-2xl bg-volt font-display text-3xl font-bold uppercase tracking-wide text-volt-ink shadow-glow transition-transform active:scale-[0.98] disabled:opacity-80"
          >
            {step === 'idle' ? (
              `Buy in ${moneyShort(amount, points)}`
            ) : (
              <>
                <Spinner size={24} /> <span className="text-2xl">{step === 'funding' ? 'Getting your chips…' : 'Locking it in…'}</span>
              </>
            )}
          </button>
          {error && <InlineError text={error} />}
          <p className="mt-3 text-center text-xs text-pitch-400">
            {points
              ? 'Points only tonight. No money involved.'
              : 'Test money only, nothing real. Your winnings are paid out automatically after the game.'}
          </p>
          <button onClick={onSkip} className="mt-1 min-h-[44px] text-sm font-medium text-pitch-400">
            Just watch for now
          </button>
        </>
      )}
    </div>
  );
}
