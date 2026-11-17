import { payoutPerDollar, type Market } from '@huddle/shared';
import {
  Burst,
  Icon,
  Kinetic,
  LockRing,
  MarkerShape,
  Pct,
  Roll,
  Sparkline,
  SplitBar,
  SplitMarkers,
  pctLabel,
  pctText,
  payoutText,
  toneFor,
  useReplayClass,
  useSeries,
} from '@huddle/ui';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ago,
  ammBuyPreview,
  ammCashOutValue,
  countdown,
  formatShares,
  holdingsFor,
  lockText,
  marketResult,
  poolPayoutPerDollar,
  poolPreview,
  poolTotal,
  priceHistory,
  prosRow,
  roomProb,
  stakeChips,
  type Countdown,
} from '../lib/markets';
import { money, moneyShort, pnl } from '../lib/money';
import { useApp } from '../lib/session';
import { BetBody } from './BetBody';
import { act, cx, useNow, useParty, useUi } from './ctx';
import { InlineError, Money, useCoins } from './primitives';
import { tone } from './tones';

const MODE_LABEL: Record<Market['mode'], string> = { pool: 'Pool', amm: 'Market', bet: 'Head-to-head' };
const SETTLED = new Set<Market['state']>(['resolved', 'final', 'disputed']);

/** Fill a CSS custom property without fighting React's style typing. */
const vars = (v: Record<string, string | number>) => v as CSSProperties;

/** Where the coins land when you stake: the split bar (the pot). */
export interface CardFlow {
  fire(from: Element | null): void;
}

// ------------------------------------------------------------------ card

export function MarketCard({ market }: { market: Market }) {
  const { snap, client, points } = useParty();
  const now = useNow(250);
  const cd = market.state === 'open' ? countdown(market, now) : null;
  const viewOnly = market.kind === 'moment' && snap.you?.momentMarketsAllowed === false;
  const lockingNow = market.state === 'open' && !!cd && cd.remainingMs === 0;
  const live = market.state === 'open' && !lockingNow;
  const locked = market.state === 'locked' || lockingNow;
  // A running clock on a moment gets the ring (ring-drain, last-call); everything else says it in words.
  const ring = live && !!cd && market.kind === 'moment' && cd.remainingMs < 100_000;
  const urgent = ring && !!cd?.urgent;
  const moment = market.kind === 'moment';
  // takeover: only for a moment that opened in the last few seconds (not on every tab switch).
  const [fresh] = useState(() => moment && market.state === 'open' && client.now() - Date.parse(market.openedAt ?? market.createdAt) < 6000);
  // lock-snap: a one-off violet flash the moment this card locks.
  const lockFlash = useReplayClass(locked, 'x');
  const split = useRef<HTMLDivElement>(null);
  const [coins, fireCoins] = useCoins();
  const flow: CardFlow = { fire: (from) => fireCoins(from, split.current, 3) };
  const step = (i: number) => (fresh ? vars({ '--d': `${160 + i * 80}ms` }) : undefined);

  return (
    <article
      data-testid="market-card"
      data-market-id={market.id}
      data-market-state={market.state}
      aria-labelledby={`q-${market.id}`}
      className={cx('card relative overflow-hidden p-4', moment && 'pt-5', fresh && 'hd-zoom', locked && 'is-locked')}
    >
      {moment && <div className="absolute inset-x-0 top-0 h-1 bg-prime" aria-hidden="true" />}
      {fresh && <div className="hd-wipe" aria-hidden="true" />}
      {urgent && <div className="urgent-edge" aria-hidden="true" />}
      {lockFlash && locked && <div key={lockFlash} className="hd-flashout absolute inset-0 z-10 bg-zap/25" aria-hidden="true" />}

      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-h-6 items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2 text-small text-ink-muted">
              {moment ? (
                <span className="hd-pop shrink-0 rounded-full bg-prime-deep px-2.5 py-0.5 text-cap font-bold text-white" style={step(0)}>
                  Moment market
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1.5 font-semibold text-ink-2">
                  <span className="h-2 w-2 rounded-full bg-zap" aria-hidden="true" /> All game
                </span>
              )}
              <span className="truncate">
                {MODE_LABEL[market.mode]}
                {market.mode === 'pool' && poolTotal(market) > 0 && (
                  <>
                    {' · Pot '}
                    <Money value={poolTotal(market)} points={points} className="font-semibold text-ink-2" flash={false} duration={700} />
                  </>
                )}
              </span>
            </p>
            {!ring && <Status market={market} cd={cd} lockingNow={lockingNow} />}
          </div>
          <Kinetic
            as="h3"
            id={`q-${market.id}`}
            text={market.question}
            className="q mt-1.5 block text-title text-ink"
            delay={fresh ? 200 : 0}
            stagger={fresh ? 45 : 28}
          />
        </div>
        {ring && cd && (
          <LockRing
            compact
            fraction={cd.fraction}
            label={String(cd.secs)}
            state={cd.urgent ? 'urgent' : 'open'}
            size="3.25rem"
            className="-mr-1 shrink-0 text-ink"
          />
        )}
      </header>

      <div ref={split} className={cx('mt-4', fresh && 'hd-rise')} style={step(3)}>
        <Split market={market} />
      </div>

      <div className={cx('relative mt-3', fresh && 'hd-rise')} style={step(4)}>
        {market.mode === 'bet' ? (
          <BetBody market={market} live={live && !viewOnly} flow={flow} />
        ) : (
          <OutcomeTrader market={market} live={live && !viewOnly} flow={flow} />
        )}
      </div>

      {viewOnly && market.state === 'open' && (
        <p className="mt-3 flex items-start gap-2 rounded-tile bg-canvas px-3 py-2.5 text-small text-ink-2">
          <Icon name="hourglass" size={18} className="mt-px shrink-0 text-ink-muted" />
          <span className="text-pretty">You're behind the room's TV, so quick bets are view-only. Game-long questions are still open.</span>
        </p>
      )}

      {market.mode !== 'bet' && <PositionBlock market={market} live={live} />}
      <ResultRow market={market} now={now} />
      {coins}
    </article>
  );
}

/** Lock status at the top right: words for anything without a running clock. State always in text. */
function Status({ market, cd, lockingNow }: { market: Market; cd: Countdown | null; lockingNow: boolean }) {
  const snapped = useReplayClass(market.state, 'x');
  if (market.state === 'open' && !lockingNow) {
    return <span className="shrink-0 text-right text-small text-ink-muted">{lockText(market, cd?.remainingMs ?? null)}</span>;
  }
  if (lockingNow || market.state === 'locked')
    return (
      <span key="locked" className={cx('flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-cap font-bold text-white', snapped && 'hd-snap')}>
        <Icon name="lock" size={14} /> {lockingNow ? 'Locking…' : 'Locked'}
      </span>
    );
  const [icon, text, cls] =
    market.state === 'disputed'
      ? (['flag', 'Under review', 'bg-hot-50 text-hot-600 ring-1 ring-inset ring-hot'] as const)
      : market.state === 'voided'
        ? (['refresh', 'Voided', 'bg-well text-ink-2'] as const)
        : (['check', 'Settled', 'bg-well text-ink-2'] as const);
  return (
    <span key={text} className={cx('flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-cap font-bold', cls, snapped && 'hd-snap')}>
      <Icon name={icon} size={14} /> {text}
    </span>
  );
}

/** The split, the pros' notches and legend, and the price history. Settled markets flood with the winner. */
function Split({ market }: { market: Market }) {
  const { client } = useParty();
  const n = market.outcomes.length;
  const settled = SETTLED.has(market.state) && !!market.outcome;
  const parts = market.outcomes.map((o) => ({
    id: o.id,
    label: o.label,
    // result-flood: the winner's share goes to 1 and the seam glides to the edge on the spring.
    p: settled ? (o.id === market.outcome ? 1 : 0) : roomProb(market, o.id),
  }));
  const row = SETTLED.has(market.state) || market.state === 'voided' ? null : prosRow(market);
  const idx = row ? market.outcomes.findIndex((o) => o.id === row.outcomeId) : -1;
  // Notches sit on the axis of the first outcome's share; only meaningful for binary markets.
  const axis = (p: number | undefined) => (p == null ? null : idx === 0 ? p : n === 2 && idx === 1 ? 1 - p : null);
  const winner = market.outcomes.findIndex((o) => o.id === market.outcome);
  const atLock = market.outcome ? (market.roomProbAtLock?.[market.outcome] ?? market.price?.[market.outcome]) : undefined;

  return (
    <div>
      {row && (
        <SplitMarkers
          className="mb-0.5 text-[1.0625rem] text-ink"
          markers={[
            { id: 'model', label: 'Model', p: axis(row.model), shape: 'solid' },
            { id: 'gemini', label: 'Gemini', p: axis(row.gemini), shape: 'hollow' },
          ]}
        />
      )}
      <SplitBar parts={parts} className={cx('h-3 rounded-full', market.state === 'voided' && 'opacity-40')} />
      {row && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-muted">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-zap" aria-hidden="true" />
            Room on {row.label} <Pct p={row.room} className="num text-body text-zap" duration={700} />
          </span>
          <span className="flex items-center gap-1">
            <MarkerShape shape="solid" className="text-ink" /> Model <span className="num text-body text-ink">{pctText(row.model)}%</span>
          </span>
          {row.gemini != null && (
            <span className="flex items-center gap-1">
              <MarkerShape shape="hollow" className="text-ink" /> Gemini <span className="num text-body text-ink">{pctText(row.gemini)}%</span>
              <span className="text-cap">{ago(row.geminiAsOf, client.now())}</span>
            </span>
          )}
        </p>
      )}
      {(market.state === 'open' || market.state === 'locked') && <PriceChart market={market} />}
      {settled && winner >= 0 && (
        <p className="mt-2 text-small text-ink-muted">
          <span key={market.outcome} className={cx('hd-stamp inline-block font-head font-extrabold', tone(winner, n).text)}>
            {market.outcomes[winner]!.label}
          </span>
          {atLock != null ? ` won. The room had it at ${pctText(atLock)}%.` : ' won.'}
        </p>
      )}
    </div>
  );
}

/** price-draw: the first outcome's price since the market opened, drawn on as trades land. */
function PriceChart({ market }: { market: Market }) {
  const { snap } = useParty();
  const first = market.outcomes[0];
  const nowP = first ? roomProb(market, first.id) : null;
  const pts = useSeries(market.id, nowP, first ? priceHistory(market, snap.fills) : []);
  if (!first) return null;
  const start = pts[0]?.p ?? nowP ?? 0;
  const diff = Math.round(((nowP ?? start) - start) * 100);
  const line = tone(0, market.outcomes.length).line;
  return (
    <div className="mt-3">
      <p className="flex items-baseline justify-between gap-2 text-small text-ink-2">
        <span className="truncate">
          {first.label} price since it opened at <span className="num text-ink">{pctText(start)}%</span>
        </span>
        <span className={cx('num flex shrink-0 items-center gap-0.5 text-body', diff > 0 ? 'text-yes-600' : diff < 0 ? 'text-no-600' : 'text-ink-muted')}>
          {diff !== 0 && <Icon name={diff > 0 ? 'up' : 'down'} size="0.6em" />}
          {diff === 0 ? 'Flat' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)} pts`}
        </span>
      </p>
      <Sparkline points={pts} className="mt-1 h-8 w-full" stroke={line.stroke} fill={line.fill} />
    </div>
  );
}

// ------------------------------------------------------------------ pool + amm

function OutcomeTrader({ market, live, flow }: { market: Market; live: boolean; flow: CardFlow }) {
  const { points } = useParty();
  const [pick, setPick] = useState<string | null>(null);
  const isAmm = market.mode === 'amm';
  const n = market.outcomes.length;
  if (SETTLED.has(market.state) || market.state === 'voided') return null;

  return (
    <div>
      <div className={cx('relative gap-2', n === 2 ? 'grid grid-cols-2' : 'flex flex-col')}>
        {market.outcomes.map((o, i) => {
          const p = roomProb(market, o.id);
          const per = isAmm ? payoutPerDollar(p) : poolPayoutPerDollar(market, o.id);
          return (
            <OutcomeButton
              key={o.id}
              testId={`outcome-${o.id}`}
              label={o.label}
              index={i}
              count={n}
              selected={pick === o.id}
              disabled={!live}
              onClick={() => setPick(pick === o.id ? null : o.id)}
              kickOn={pctText(p)}
              figure={<Pct p={p} arrow className="num text-head leading-none" duration={640} />}
              figureLabel={pctLabel(p)}
              note={payoutText(per > 0 ? 1 / per : null, { points })}
            />
          );
        })}
        {market.state === 'locked' && <div className="lock-veil" aria-hidden="true" />}
      </div>
      {pick && live && (
        <StakeTray
          key={pick}
          market={market}
          outcome={pick}
          flow={flow}
          onClose={() => setPick(null)}
          preview={(stake) => {
            if (isAmm) {
              const q = ammBuyPreview(market, pick, stake);
              return q ? moneyShort(q.payout, points) : '–';
            }
            return moneyShort(poolPreview(market, pick, stake), points);
          }}
          send={(stake) => ({ type: 'place_bet', marketId: market.id, outcome: pick, stake })}
        />
      )}
    </div>
  );
}

/**
 * The phone's outcome tile: a solid game tile like the box (YES blue with white text, NO tangerine
 * with ink text, sun/lilac hatched for the middle ones), label then the rolling number, the exact
 * payout under it. It kicks when its price moves; selected gets a ✓ that pops and an ink ring.
 * Labels wrap; 3+ outcomes stack.
 */
export function OutcomeButton({
  testId,
  label,
  prefix,
  index,
  count,
  selected,
  disabled,
  onClick,
  figure,
  figureLabel,
  note,
  kickOn,
}: {
  testId?: string;
  label: string;
  prefix?: string;
  index: number;
  count: number;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  figure: ReactNode;
  figureLabel: string;
  note: ReactNode;
  /** Changes when the price moves: the tile kicks. */
  kickOn?: unknown;
}) {
  const t = tone(index, count);
  const kick = useReplayClass(kickOn, 'tile-kick');
  const hatched = toneFor(index, Math.max(2, count)).startsWith('other');
  // Two outcomes sit side by side, so the label gets its own line above the number; stacked
  // (3+) tiles have the width to put the number on the right.
  const stacked = count > 2;
  return (
    <button
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`${prefix ? `${prefix} ` : ''}${label}, ${figureLabel}`}
      className={cx(
        'hd-press on-fill relative flex w-full min-w-0 flex-col overflow-hidden rounded-panel py-3 pl-4 pr-3 text-left',
        stacked ? 'min-h-[4.5rem] justify-center' : 'min-h-[7.25rem] justify-between',
        t.solid,
        t.ink,
        !disabled && t.shadow,
        selected && 'ring-4 ring-ink ring-offset-2 ring-offset-card',
        disabled && 'cursor-not-allowed',
        kick,
      )}
    >
      {hatched && <span className={cx('absolute inset-y-0 right-0 w-3', t.rule)} aria-hidden="true" />}
      <span className={cx('flex gap-2', stacked ? 'items-center justify-between pr-3' : 'flex-col')}>
        <span className="flex min-w-0 items-start gap-1.5 font-head text-lead font-extrabold leading-tight [overflow-wrap:anywhere]">
          {selected && (
            <span className="hd-pop mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-card text-ink">
              <Icon name="check" size={14} strokeWidth={3} />
            </span>
          )}
          <span className="min-w-0 hyphens-auto">
            {prefix && <span className="font-sans text-body font-bold">{prefix} </span>}
            {label}
          </span>
        </span>
        <span className="shrink-0" aria-hidden="true">
          {figure}
        </span>
      </span>
      <span className="mt-1 text-small font-semibold tnum" aria-hidden="true">
        {note}
      </span>
    </button>
  );
}

/**
 * Quick stake chips: one tap places, gold coins fly to the split. The money stays exact: each chip
 * says what you pay and what you get back if that outcome wins.
 */
export function StakeTray({
  market,
  outcome,
  onClose,
  preview,
  send,
  flow,
  verb = 'on',
  cap,
}: {
  market: Market;
  outcome: string;
  onClose: () => void;
  /** What a stake returns if it wins ("2.74 pts"). */
  preview: (stake: number) => string;
  send: (stake: number) => Parameters<typeof act>[1];
  flow?: CardFlow;
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
  const t = tone(idx, market.outcomes.length);
  const label = market.outcomes[idx]?.label ?? outcome;

  const place = async (stake: number, el: HTMLElement) => {
    setBusy(stake);
    setError(null);
    const err = await act(client, send(stake));
    setBusy(null);
    if (err) return setError(err);
    flow?.fire(el);
    notify(`${moneyShort(stake, points)} ${verb} ${label}. You're in.`, 'win');
    onClose();
  };

  return (
    <div className="hd-rise mt-3 rounded-tile bg-canvas p-3" role="group" aria-label={`Stake on ${label}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-small text-ink-2">
          You pay, you get back if <span className={cx('font-bold', t.text)}>{label}</span> wins
        </span>
        <button onClick={onClose} className="btn-quiet -my-1 -mr-1.5 min-h-11 w-11 px-0" aria-label="Cancel">
          <Icon name="x" size={20} />
        </button>
      </div>
      {chips.length ? (
        <div className={cx('mt-2 grid gap-2', chips.length >= 4 ? 'grid-cols-4' : chips.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
          {chips.map((c, i) => (
            <button
              key={c.amount}
              data-testid="stake-chip"
              data-stake={c.amount}
              disabled={busy !== null}
              onClick={(e) => place(c.amount, e.currentTarget)}
              aria-label={`Pay ${money(c.amount, points)}${c.isMax ? ', the most you can' : ''}, get ${preview(c.amount)} if ${label} wins`}
              style={vars({ '--d': `${i * 50}ms` })}
              className={cx(
                'hd-pop hd-press flex min-h-14 flex-col items-center justify-center rounded-tile px-1 shadow-lift',
                busy === c.amount ? 'bg-zap text-zap-ink shadow-zap' : 'bg-card text-ink ring-1 ring-inset ring-rule',
                busy !== null && busy !== c.amount && 'opacity-50',
              )}
            >
              <span className="num flex items-baseline gap-1 text-lead leading-tight">
                {moneyShort(c.amount, points)}
                {c.isMax && <span className="font-sans text-cap font-bold">max</span>}
              </span>
              <span className={cx('text-cap font-semibold leading-tight tnum', busy === c.amount ? 'text-zap-ink' : 'text-ink-2')}>
                {busy === c.amount ? 'Placing…' : `get ${preview(c.amount)}`}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <button onClick={() => setTopUp(true)} className="btn-secondary mt-2 w-full">
          <Icon name="plus" size={18} /> Add more to play
        </button>
      )}
      {error && <InlineError text={error} />}
    </div>
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
  if (!holdings.length || market.state === 'voided' || SETTLED.has(market.state)) return null;

  return (
    <div className="mt-3 space-y-2">
      {holdings.map((h) => {
        const idx = market.outcomes.findIndex((o) => o.id === h.outcome);
        const t = tone(idx, market.outcomes.length);
        const label = market.outcomes[idx]?.label ?? h.outcome;
        if (market.mode === 'amm') {
          const value = ammCashOutValue(market, h.shares, h.outcome);
          // Under half a cent either way reads as even, never "−$0.00".
          const raw = value != null ? value - h.stake : 0;
          const gain = Math.abs(raw) < 5_000 ? 0 : raw;
          return (
            <div key={h.outcome} className="relative overflow-hidden rounded-tile bg-canvas py-3 pl-4 pr-3">
              <span className={cx('absolute inset-y-0 left-0 w-1', t.rule)} aria-hidden="true" />
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-small text-ink-2">
                  You hold <span className="num text-body text-ink">{formatShares(h.shares)}</span> <span className={cx('font-bold', t.text)}>{label}</span> shares
                </span>
                {value != null &&
                  (gain === 0 ? (
                    <span className="shrink-0 text-cap text-ink-muted">Even so far</span>
                  ) : (
                    <span className={cx('num flex shrink-0 items-center gap-1 text-body', gain > 0 ? 'text-yes-600' : 'text-no-600')}>
                      <Icon name={gain > 0 ? 'up' : 'down'} size={11} />
                      <Roll text={pnl(gain, points)} value={gain} />
                    </span>
                  ))}
              </div>
              <p className="mt-0.5 text-cap text-ink-muted">
                Cost <span className="tnum text-ink-2">{money(h.stake, points)}</span> · pays{' '}
                <span className="tnum text-ink-2">{money(h.potential, points)}</span> if it hits
              </p>
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
                  aria-label={`Cash out now: ${money(value, points)}`}
                  className={cx(gain > 0 ? 'btn-prime' : 'btn-secondary min-h-12', 'mt-3 w-full')}
                >
                  {busy === h.outcome ? (
                    'Cashing out…'
                  ) : (
                    <>
                      Cash out now: <Money value={value} points={points} className="num text-lead" duration={500} />
                    </>
                  )}
                </button>
              )}
            </div>
          );
        }
        return <StakeRow key={h.outcome} stake={h.stake} potential={h.potential} label={label} toneIndex={idx} count={market.outcomes.length} />;
      })}
      {error && <InlineError text={error} />}
    </div>
  );
}

/** "Your stake 2 pts on Yes · pays about 2.85 pts": stamps when it changes. */
export function StakeRow({
  stake,
  potential,
  label,
  toneIndex,
  count,
  lead = 'Your stake',
  payLabel = 'pays about',
}: {
  stake: number;
  potential: number;
  label: string;
  toneIndex: number;
  count: number;
  lead?: string;
  payLabel?: string;
}) {
  const { points } = useParty();
  const t = tone(toneIndex, count);
  const stamp = useReplayClass(stake, 'x');
  return (
    <div className="relative flex items-center justify-between gap-3 overflow-hidden rounded-tile bg-canvas py-2.5 pl-4 pr-3">
      <span className={cx('absolute inset-y-0 left-0 w-1', t.rule)} aria-hidden="true" />
      <span className="min-w-0 text-small text-ink-2">
        {lead}{' '}
        <span key={stamp} className={cx('num inline-block text-body text-ink', stamp && 'hd-stamp')}>
          {money(stake, points)}
        </span>{' '}
        on <span className={cx('font-bold', t.text)}>{label}</span>
      </span>
      <span className="shrink-0 text-right text-cap text-ink-muted">
        {payLabel} <Roll text={money(potential, points)} className="num text-small text-ink" duration={640} />
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ results

function ResultRow({ market, now }: { market: Market; now: number }) {
  const { client, snap, me, points, positions } = useParty();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flagged, setFlagged] = useState(false);
  const s = market.state;
  const landed = useReplayClass(s, 'x');
  if (s === 'open') return null;
  if (s === 'locked')
    return (
      <Line icon="hourglass">
        <span className="text-ink-2">Locked. Waiting for the result…</span>
      </Line>
    );
  const res = marketResult(market, positions, snap.fills, me);
  if (s === 'voided')
    return (
      <Line icon="refresh">
        <span className="text-ink-2">
          Voided. {res.kind === 'refunded' ? `Your ${money(res.amount, points)} is back.` : 'Every stake is refunded.'}
        </span>
      </Line>
    );
  const disputeLeft = market.disputeEndsAt ? Math.ceil((Date.parse(market.disputeEndsAt) - now) / 1000) : 0;
  const celebrate = !!landed && s === 'resolved';
  return (
    <div className="relative mt-3 border-t border-rule pt-3">
      {res.kind === 'none' ? (
        <p className="text-small text-ink-muted">No stake from you on this one.</p>
      ) : (
        <ResultBadge res={res} points={points} animate={celebrate} big />
      )}
      {celebrate && res.kind === 'won' && <Burst count={14} seed={market.id.length + 7} x="4rem" y="1.2rem" spread={8} />}
      {s === 'disputed' && (
        <p className="mt-2 flex items-center gap-2 text-small text-ink-2">
          <Icon name="flag" size={16} className="text-hot-600" /> Flagged. The host is checking the result.
        </p>
      )}
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
          className="btn-quiet -ml-3 mt-1 text-small"
        >
          <Icon name="flag" size={16} /> {busy ? 'Flagging…' : 'Wrong result? Flag it'}
          <span className="num text-ink-muted">
            <Roll text={String(disputeLeft)} duration={300} flash={false} />
            &nbsp;s
          </span>
        </button>
      )}
      {flagged && s === 'resolved' && <p className="mt-2 text-small text-ink-2">Thanks. The host will take a look.</p>}
      {error && <InlineError text={error} />}
    </div>
  );
}

/**
 * Your result on a settled market: "Called it +0.60 pts" (a solid YES pill with ✓), "Cooked
 * −1.00 pts" (a tangerine tint with ✕, no confetti), "Refunded". A win glints when it lands.
 */
export function ResultBadge({
  res,
  points,
  animate = false,
  big = false,
}: {
  res: ReturnType<typeof marketResult>;
  points: boolean;
  animate?: boolean;
  big?: boolean;
}) {
  const size = big ? 'text-lead' : 'text-body';
  const pill = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-bold';
  if (res.kind === 'won')
    return (
      <span className={cx(pill, 'bg-yes text-yes-on shadow-yes', animate && 'hd-shine hd-stamp')}>
        <Icon name="check" size={16} strokeWidth={2.8} />
        Called it <span className={cx('num', size)}>{pnl(res.amount, points)}</span>
      </span>
    );
  if (res.kind === 'lost')
    return (
      <span className={cx(pill, 'bg-no-50 text-no-600', animate && 'hd-stamp')}>
        <Icon name="x" size={16} strokeWidth={2.8} />
        Cooked <span className={cx('num', size)}>{pnl(-res.amount, points)}</span>
      </span>
    );
  if (res.kind === 'refunded')
    return (
      <span className={cx(pill, 'bg-well text-ink-2')}>
        <Icon name="refresh" size={16} /> Refunded {money(res.amount, points)}
      </span>
    );
  return null;
}

function Line({ icon, children }: { icon: 'hourglass' | 'refresh'; children: ReactNode }) {
  return (
    <p className="mt-3 flex items-center gap-2 border-t border-rule pt-3 text-small">
      <Icon name={icon} size={16} className="shrink-0 text-ink-muted" />
      {children}
    </p>
  );
}
