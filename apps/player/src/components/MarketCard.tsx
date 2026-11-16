import { formatPct, payoutPerDollar, type Market } from '@huddle/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useState, type ReactNode } from 'react';
import {
  ago,
  ammBuyPreview,
  ammCashOutValue,
  countdown,
  formatShares,
  holdingsFor,
  marketResult,
  poolPayoutPerDollar,
  poolPreview,
  poolTotal,
  prosRow,
  roomProb,
  stakeChips,
} from '../lib/markets';
import { money, moneyShort, pnl } from '../lib/money';
import { useApp } from '../lib/session';
import { BetBody } from './BetBody';
import { act, cx, useNow, useParty, useUi } from './ctx';
import { Icon, Spinner } from './Icon';
import { CountdownRing, Pill, Ticker } from './primitives';

// ------------------------------------------------------------------ tones

export const TONES = [
  { text: 'text-up', soft: 'bg-up/10', border: 'border-up/35', solid: 'bg-up text-up-ink', bar: 'bg-up' },
  { text: 'text-down', soft: 'bg-down/10', border: 'border-down/35', solid: 'bg-down text-down-ink', bar: 'bg-down' },
  { text: 'text-pitch-50', soft: 'bg-pitch-700/50', border: 'border-pitch-600', solid: 'bg-pitch-50 text-pitch-950', bar: 'bg-pitch-200' },
] as const;
export const toneFor = (i: number) => TONES[Math.min(i, 2)]!;

const MODE_LABEL: Record<Market['mode'], string> = { pool: 'Pool', amm: 'Market', bet: 'Head-to-head' };

// ------------------------------------------------------------------ card

export function MarketCard({ market }: { market: Market }) {
  const { snap } = useParty();
  const now = useNow(250);
  const cd = market.state === 'open' ? countdown(market, now) : null;
  const viewOnly = market.kind === 'moment' && snap.you?.momentMarketsAllowed === false;
  const live = market.state === 'open' && !(cd && cd.remainingMs === 0);

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cx(
        'rounded-card border bg-pitch-900 p-4 shadow-card',
        market.kind === 'moment' && live ? 'border-volt/30' : 'border-pitch-700',
        !live && market.state !== 'open' && 'bg-pitch-900/70',
      )}
    >
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {market.kind === 'moment' ? (
              <Pill className="bg-volt/15 text-volt">
                {live && <span className="h-1.5 w-1.5 rounded-full bg-volt" />}Moment
              </Pill>
            ) : (
              <Pill className="bg-pitch-700 text-pitch-200">Full game</Pill>
            )}
            <Pill className="bg-pitch-800 text-pitch-400">{MODE_LABEL[market.mode]}</Pill>
            <StateTag market={market} lockingNow={market.state === 'open' && !live} />
          </div>
          <h3 className="font-display text-[22px] font-semibold leading-tight text-pitch-50">{market.question}</h3>
        </div>
        {cd && cd.remainingMs > 0 && <CountdownRing fraction={cd.fraction} secs={cd.secs} urgent={cd.urgent} />}
      </header>

      <div className="mt-3.5">
        {market.mode === 'bet' ? (
          <BetBody market={market} live={live && !viewOnly} />
        ) : (
          <OutcomeTrader market={market} live={live && !viewOnly} />
        )}
      </div>

      {viewOnly && market.state === 'open' && (
        <p className="mt-3 flex items-center gap-2 text-sm text-pitch-400">
          <Icon name="hourglass" size={16} /> You're behind the room's TV, so quick bets are view-only. Full-game questions are open.
        </p>
      )}

      {market.mode !== 'bet' && <PositionBlock market={market} live={live} />}
      <SettledFooter market={market} now={now} />
      <ProsStrip market={market} now={now} />
    </motion.article>
  );
}

function StateTag({ market, lockingNow }: { market: Market; lockingNow: boolean }) {
  if (lockingNow || market.state === 'locked')
    return (
      <Pill className="bg-pitch-700 text-pitch-200">
        <Icon name="lock" size={11} /> {lockingNow ? 'Locking' : 'Locked'}
      </Pill>
    );
  if (market.state === 'disputed') return <Pill className="bg-gemini/20 text-gemini">Under review</Pill>;
  if (market.state === 'voided') return <Pill className="bg-pitch-700 text-pitch-200">Voided</Pill>;
  if (market.state === 'resolved' || market.state === 'final') return <Pill className="bg-pitch-700 text-pitch-200">Final</Pill>;
  return null;
}

// ------------------------------------------------------------------ pool + amm

function OutcomeTrader({ market, live }: { market: Market; live: boolean }) {
  const { points } = useParty();
  const [pick, setPick] = useState<string | null>(null);
  const isAmm = market.mode === 'amm';
  const cols = market.outcomes.length === 2 ? 'grid-cols-2' : market.outcomes.length === 3 ? 'grid-cols-3' : 'grid-cols-2';

  return (
    <div>
      <div className={cx('grid gap-2.5', cols)}>
        {market.outcomes.map((o, i) => {
          const p = roomProb(market, o.id);
          const tone = toneFor(i);
          const per = isAmm ? payoutPerDollar(p) : poolPayoutPerDollar(market, o.id);
          const won = market.outcome === o.id && (market.state === 'resolved' || market.state === 'final' || market.state === 'disputed');
          const selected = pick === o.id;
          return (
            <button
              key={o.id}
              disabled={!live}
              onClick={() => setPick(selected ? null : o.id)}
              aria-pressed={selected}
              className={cx(
                'relative min-h-[84px] overflow-hidden rounded-2xl border px-3 pb-3 pt-2.5 text-left transition-[transform,background-color] active:scale-[0.97] disabled:active:scale-100',
                selected ? cx(tone.solid, 'border-transparent') : cx(tone.soft, tone.border),
                !live && !won && 'opacity-60',
                won && 'ring-2 ring-volt',
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span className={cx('truncate font-display text-lg font-bold uppercase tracking-wide', selected ? '' : tone.text)}>{o.label}</span>
                {won && <Icon name="check" size={18} className="text-volt" />}
              </div>
              <Ticker value={p} format={formatPct} className="font-display text-[34px] font-bold leading-none" />
              <div className={cx('mt-1 text-xs tnum', selected ? 'opacity-80' : 'text-pitch-400')}>
                {points ? `1 pays ${per.toFixed(2)}` : `$1 pays $${per.toFixed(2)}`}
              </div>
              <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
                <motion.div className={cx('h-full', selected ? 'bg-black/30' : tone.bar)} animate={{ width: `${Math.round(p * 100)}%` }} />
              </div>
            </button>
          );
        })}
      </div>
      {market.mode === 'pool' && (
        <div className="mt-2 flex items-center justify-between text-xs text-pitch-400">
          <span>
            Pot <span className="tnum text-pitch-200">{money(poolTotal(market), points)}</span>
          </span>
          <span>Winners split the pot</span>
        </div>
      )}
      <AnimatePresence initial={false}>
        {pick && live && (
          <StakeTray
            key={pick}
            market={market}
            outcome={pick}
            onClose={() => setPick(null)}
            preview={(stake) => {
              if (isAmm) {
                const q = ammBuyPreview(market, pick, stake);
                return q ? `pays ${moneyShort(q.payout, points)}` : '';
              }
              return `pays ${moneyShort(poolPreview(market, pick, stake), points)}`;
            }}
            send={(stake) => ({ type: 'place_bet', marketId: market.id, outcome: pick, stake })}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Quick stake chips: one tap places. Shared by every mode. */
export function StakeTray({
  market,
  outcome,
  onClose,
  preview,
  send,
  verb = 'on',
  cap,
}: {
  market: Market;
  outcome: string;
  onClose: () => void;
  preview: (stake: number) => string;
  send: (stake: number) => Parameters<typeof act>[1];
  verb?: string;
  cap?: number;
}) {
  const { client, snap, balance, points } = useParty();
  const notify = useNotify();
  const setTopUp = useUi((s) => s.setTopUp);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chips = stakeChips(balance, snap.party.config, cap);
  const idx = market.outcomes.findIndex((o) => o.id === outcome);
  const label = market.outcomes[idx]?.label ?? outcome;

  const place = async (stake: number) => {
    setBusy(stake);
    setError(null);
    const err = await act(client, send(stake));
    setBusy(null);
    if (err) return setError(err);
    notify(`${moneyShort(stake, points)} ${verb} ${label}. You're in.`, 'win');
    onClose();
  };

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="overflow-hidden"
    >
      <div className="pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm text-pitch-200">
            Stake on <span className={cx('font-semibold', toneFor(idx).text)}>{label}</span>
          </span>
          <button onClick={onClose} className="-mr-2 grid h-9 w-9 place-items-center rounded-full text-pitch-400" aria-label="Cancel">
            <Icon name="x" size={18} />
          </button>
        </div>
        {chips.length ? (
          <div className={cx('grid gap-2', chips.length >= 4 ? 'grid-cols-4' : chips.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
            {chips.map((c) => (
              <button
                key={c.amount}
                disabled={busy !== null}
                onClick={() => place(c.amount)}
                className="relative flex min-h-[64px] flex-col items-center justify-center rounded-xl bg-volt px-1 text-volt-ink transition-transform active:scale-95 disabled:opacity-60"
              >
                {busy === c.amount ? (
                  <Spinner />
                ) : (
                  <>
                    {c.isMax && <span className="text-[9px] font-bold uppercase leading-none tracking-widest opacity-70">Max</span>}
                    <span className="font-display text-xl font-bold leading-tight tnum">{moneyShort(c.amount, points)}</span>
                    <span className="text-[10px] font-medium leading-tight opacity-75 tnum">{preview(c.amount)}</span>
                  </>
                )}
              </button>
            ))}
          </div>
        ) : (
          <button onClick={() => setTopUp(true)} className="w-full rounded-xl border border-volt/40 py-3.5 font-semibold text-volt">
            Top up to play
          </button>
        )}
        {error && <InlineError text={error} />}
      </div>
    </motion.div>
  );
}

export function InlineError({ text }: { text: string }) {
  return (
    <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 flex items-start gap-2 text-sm text-down" role="alert">
      <Icon name="x" size={16} className="mt-0.5 shrink-0" /> {text}
    </motion.p>
  );
}

export function useNotify() {
  return useApp((s) => s.notify);
}

// ------------------------------------------------------------------ positions

function PositionBlock({ market, live }: { market: Market; live: boolean }) {
  const { client, snap, points } = useParty();
  const notify = useNotify();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const holdings = holdingsFor(market, snap.you?.positions ?? []);
  if (!holdings.length || market.state === 'voided' || market.state === 'resolved' || market.state === 'final') return null;

  return (
    <div className="mt-3 space-y-2">
      {holdings.map((h) => {
        const idx = market.outcomes.findIndex((o) => o.id === h.outcome);
        const label = market.outcomes[idx]?.label ?? h.outcome;
        if (market.mode === 'amm') {
          const value = ammCashOutValue(market, h.shares, h.outcome);
          const gain = value != null ? value - h.stake : 0;
          return (
            <div key={h.outcome} className="rounded-2xl border border-pitch-700 bg-pitch-800/70 p-3">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-pitch-200">
                  <span className={cx('font-semibold', toneFor(idx).text)}>{formatShares(h.shares)} {label}</span> shares
                </span>
                <span className="text-xs text-pitch-400 tnum">cost {money(h.stake, points)}</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between text-xs text-pitch-400">
                <span>
                  Pays <span className="tnum text-pitch-200">{money(h.potential, points)}</span> if it hits
                </span>
                {value != null && (
                  <span className={cx('flex items-center gap-0.5 tnum', gain >= 0 ? 'text-up' : 'text-down')}>
                    <Icon name={gain >= 0 ? 'up' : 'down'} size={12} />
                    {pnl(gain, points)}
                  </span>
                )}
              </div>
              {live && value != null && (
                <button
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(h.outcome);
                    setError(null);
                    const err = await act(client, { type: 'amm_trade', marketId: market.id, outcome: h.outcome, side: 'sell', shares: 'all' });
                    setBusy(null);
                    if (err) setError(err);
                    else notify(`Cashed out ${money(value, points)}`, 'win');
                  }}
                  className="mt-2.5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-volt/50 bg-volt/10 font-semibold text-volt active:scale-[0.98] disabled:opacity-60"
                >
                  {busy === h.outcome ? (
                    <Spinner />
                  ) : (
                    <>
                      Cash out now: <Ticker value={value} format={(v) => money(Math.round(v), points)} className="font-display text-xl font-bold" />
                    </>
                  )}
                </button>
              )}
            </div>
          );
        }
        return (
          <div key={h.outcome} className="flex items-center justify-between rounded-2xl border border-pitch-700 bg-pitch-800/70 px-3 py-2.5 text-sm">
            <span className="text-pitch-200">
              You: <span className="tnum font-semibold text-pitch-50">{money(h.stake, points)}</span> on{' '}
              <span className={cx('font-semibold', toneFor(idx).text)}>{label}</span>
            </span>
            <span className="text-xs text-pitch-400">
              pays ≈ <span className="tnum text-pitch-200">{money(h.potential, points)}</span>
            </span>
          </div>
        );
      })}
      {error && <InlineError text={error} />}
    </div>
  );
}

// ------------------------------------------------------------------ settled

function SettledFooter({ market, now }: { market: Market; now: number }) {
  const { client, snap, me, points } = useParty();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flagged, setFlagged] = useState(false);
  const s = market.state;
  if (s === 'open') return null;
  if (s === 'locked')
    return (
      <Footer>
        <Icon name="hourglass" size={16} className="text-pitch-400" />
        <span className="text-pitch-200">Locked. Waiting for the result…</span>
      </Footer>
    );
  const res = marketResult(market, snap.you?.positions ?? [], snap.fills, me);
  const outcomeLabel = market.outcomes.find((o) => o.id === market.outcome)?.label;
  if (s === 'voided')
    return (
      <Footer>
        <Icon name="refresh" size={16} className="text-pitch-400" />
        <span className="text-pitch-200">
          Voided. {res.kind === 'refunded' ? `Your ${money(res.amount, points)} is back.` : 'Every stake refunded.'}
        </span>
      </Footer>
    );
  const disputeLeft = market.disputeEndsAt ? Math.ceil((Date.parse(market.disputeEndsAt) - now) / 1000) : 0;
  return (
    <div className="mt-3 border-t border-pitch-700 pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-pitch-400">
          Result: <span className="font-display text-lg font-bold uppercase text-pitch-50">{outcomeLabel ?? '—'}</span>
        </span>
        <ResultBadge res={res} points={points} />
      </div>
      {s === 'disputed' && <p className="mt-2 text-sm text-gemini">Flagged. The host is checking the result.</p>}
      {s === 'resolved' && disputeLeft > 0 && !flagged && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const err = await act(client, { type: 'dispute', marketId: market.id, reason: 'Player flagged the result' });
            setBusy(false);
            if (err) setError(err);
            else setFlagged(true);
          }}
          className="mt-2 flex min-h-[44px] items-center gap-2 rounded-xl px-1 text-sm font-medium text-pitch-200 active:text-pitch-50"
        >
          <Icon name="flag" size={16} /> Wrong result? Flag it <span className="tnum text-pitch-400">({disputeLeft}s)</span>
        </button>
      )}
      {flagged && s === 'resolved' && <p className="mt-2 text-sm text-gemini">Thanks, the host will take a look.</p>}
      {error && <InlineError text={error} />}
    </div>
  );
}

export function ResultBadge({ res, points }: { res: ReturnType<typeof marketResult>; points: boolean }) {
  if (res.kind === 'won')
    return (
      <Pill className="bg-up/15 px-2.5 py-1 text-[12px] text-up">
        <Icon name="trophy" size={13} /> Won {pnl(res.amount, points)}
      </Pill>
    );
  if (res.kind === 'lost')
    return (
      <Pill className="bg-down/15 px-2.5 py-1 text-[12px] text-down">
        <Icon name="x" size={13} /> Lost {money(res.amount, points)}
      </Pill>
    );
  if (res.kind === 'refunded') return <Pill className="bg-pitch-700 text-pitch-200">Refunded</Pill>;
  return null;
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex items-center gap-2 border-t border-pitch-700 pt-3 text-sm">{children}</div>;
}

// ------------------------------------------------------------------ friends vs. the pros

function ProsStrip({ market, now }: { market: Market; now: number }) {
  const row = prosRow(market);
  if (!row) return null;
  return (
    <div className="mt-3 rounded-xl bg-pitch-950/60 px-3 py-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-pitch-400">
        Friends vs. the Pros · {row.label}
      </div>
      <div className="flex items-end justify-between gap-2">
        <Stat label="Room" value={<Ticker value={row.room} format={formatPct} />} color="text-volt" />
        <Stat label="Model" value={formatPct(row.model)} color="text-model" />
        {row.gemini != null ? (
          <Stat label={`Gemini · ${ago(row.geminiAsOf, now)}`} value={formatPct(row.gemini)} color="text-gemini" />
        ) : (
          <Stat label="Gemini" value="—" color="text-pitch-600" />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: ReactNode; color: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className={cx('font-display text-2xl font-bold leading-none tnum', color)}>{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-pitch-400">{label}</div>
    </div>
  );
}
