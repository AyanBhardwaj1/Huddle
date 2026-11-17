import { payoutPerDollar, type Market } from '@huddle/shared';
import { Icon, LockRing, MarkerShape, Pct, Roll, SplitBar, SplitMarkers, pctLabel, pctText, payoutText, useReplayClass } from '@huddle/ui';
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
  const { snap, client } = useParty();
  const now = useNow(250);
  const cd = market.state === 'open' ? countdown(market, now) : null;
  const viewOnly = market.kind === 'moment' && snap.you?.momentMarketsAllowed === false;
  const lockingNow = market.state === 'open' && !!cd && cd.remainingMs === 0;
  const live = market.state === 'open' && !lockingNow;
  // A running clock on a moment gets the ring (ring-drain, last-call); everything else says it in words.
  const ring = live && !!cd && market.kind === 'moment' && cd.remainingMs < 100_000;
  // takeover-wipe: only for a moment that opened in the last few seconds (not on every tab switch).
  const [fresh] = useState(
    () => market.kind === 'moment' && market.state === 'open' && client.now() - Date.parse(market.openedAt ?? market.createdAt) < 6000,
  );
  // lock-snap: a one-off flash the moment this card locks.
  const lockFlash = useReplayClass(market.state === 'locked' || lockingNow, 'x');
  const split = useRef<HTMLDivElement>(null);
  const [coins, fireCoins] = useCoins();
  const flow: CardFlow = { fire: (from) => fireCoins(from, split.current, 5) };
  const step = (i: number) => (fresh ? vars({ '--d': `${120 + i * 80}ms` }) : undefined);

  return (
    <article
      data-testid="market-card"
      data-market-id={market.id}
      data-market-state={market.state}
      aria-labelledby={`q-${market.id}`}
      className={cx('relative overflow-hidden rounded-panel bg-night-900 p-4', fresh && 'hd-fade')}
    >
      {fresh && <div className="hd-wipe" aria-hidden="true" />}
      {lockFlash && (market.state === 'locked' || lockingNow) && (
        <div key={lockFlash} className="hd-flashout absolute inset-0 z-10 bg-chalk/25" aria-hidden="true" />
      )}

      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 text-small text-night-400">
              {MODE_LABEL[market.mode]}
              {market.mode === 'pool' && poolTotal(market) > 0 && (
                <>
                  {' · Pot '}
                  <Money value={poolTotal(market)} points={snap.party.config.settlement === 'points'} className="text-night-200" flash={false} />
                </>
              )}
            </p>
            {!ring && <Status market={market} cd={cd} lockingNow={lockingNow} />}
          </div>
          <h3
            id={`q-${market.id}`}
            className={cx('mt-1 text-balance font-display text-title font-bold stretch-semi text-chalk', fresh && 'hd-rise')}
            style={step(0)}
          >
            {market.question}
          </h3>
        </div>
        {ring && cd && (
          <LockRing fraction={cd.fraction} label={String(cd.secs)} state={cd.urgent ? 'urgent' : 'open'} size="3.5rem" className="-mr-1 -mt-1 text-chalk" />
        )}
      </header>

      <div ref={split} className={cx('mt-4', fresh && 'hd-rise')} style={step(1)}>
        <Split market={market} />
      </div>

      <div className={cx('mt-3', fresh && 'hd-rise')} style={step(2)}>
        {market.mode === 'bet' ? (
          <BetBody market={market} live={live && !viewOnly} flow={flow} />
        ) : (
          <OutcomeTrader market={market} live={live && !viewOnly} flow={flow} />
        )}
      </div>

      {viewOnly && market.state === 'open' && (
        <p className="mt-3 flex items-start gap-2 text-small text-night-200">
          <Icon name="hourglass" size={18} className="mt-px shrink-0 text-night-400" />
          <span className="text-pretty">You're behind the room's TV, so quick bets are view-only. Game-long questions are still open.</span>
        </p>
      )}

      {market.mode !== 'bet' && <PositionBlock market={market} live={live} />}
      <ResultRow market={market} now={now} />
      {coins}
    </article>
  );
}

/** Lock status at the top right: the ring for a running clock, words otherwise. State always in text. */
function Status({ market, cd, lockingNow }: { market: Market; cd: Countdown | null; lockingNow: boolean }) {
  const snapped = useReplayClass(market.state, 'x');
  if (market.state === 'open' && !lockingNow) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-small text-night-200">
        <span className="h-1.5 w-1.5 rounded-full bg-flood" aria-hidden="true" />
        <span>
          <span className="font-semibold text-chalk">Open</span> · {lockText(market, cd?.remainingMs ?? null).replace(/^Locks/, 'locks')}
        </span>
      </span>
    );
  }
  const [icon, text] =
    lockingNow
      ? (['lock', 'Locking…'] as const)
      : market.state === 'locked'
        ? (['lock', 'Locked'] as const)
        : market.state === 'disputed'
          ? (['flag', 'Under review'] as const)
          : market.state === 'voided'
            ? (['refresh', 'Voided'] as const)
            : (['check', 'Settled'] as const);
  return (
    <span key={text} className={cx('flex shrink-0 items-center gap-1.5 text-small font-semibold text-night-200', snapped && 'hd-snap')}>
      <Icon name={icon} size={16} /> {text}
    </span>
  );
}

/** The split, the pros' notches and their legend. Settled markets flood with the winner. */
function Split({ market }: { market: Market }) {
  const { client } = useParty();
  const n = market.outcomes.length;
  const settled = SETTLED.has(market.state) && !!market.outcome;
  const parts = market.outcomes.map((o) => ({
    id: o.id,
    label: o.label,
    // result-flood: the winner's share goes to 1 and the seam glides to the edge (700ms).
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
          className="mb-0.5 text-[1.0625rem] text-night-300"
          markers={[
            { id: 'model', label: 'Model', p: axis(row.model), shape: 'solid' },
            { id: 'gemini', label: 'Gemini', p: axis(row.gemini), shape: 'hollow' },
          ]}
        />
      )}
      <SplitBar
        parts={parts}
        className={cx('h-2.5 rounded-full', (market.state === 'locked' || market.state === 'voided') && 'pl-dim', market.state === 'voided' && 'opacity-50')}
      />
      {row && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-night-400">
          <span>
            {row.label}: room <span className="font-display font-bold text-chalk tnum">{pctText(row.room)}%</span>
          </span>
          <span className="flex items-center gap-1">
            <MarkerShape shape="solid" className="text-night-300" /> Model{' '}
            <span className="font-display font-bold text-night-200 tnum">{pctText(row.model)}%</span>
          </span>
          {row.gemini != null && (
            <span className="flex items-center gap-1">
              <MarkerShape shape="hollow" className="text-night-300" /> Gemini{' '}
              <span className="font-display font-bold text-night-200 tnum">{pctText(row.gemini)}%</span>
              <span className="text-cap">{ago(row.geminiAsOf, client.now())}</span>
            </span>
          )}
        </p>
      )}
      {settled && winner >= 0 && (
        <p className="mt-2 text-small text-night-400">
          <span className={cx('font-bold', tone(winner, n).text)}>{market.outcomes[winner]!.label}</span>
          {atLock != null ? ` won. The room had it at ${pctText(atLock)}%.` : ' won.'}
        </p>
      )}
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
      <div className={cx('gap-2', n === 2 ? 'grid grid-cols-2' : 'flex flex-col')}>
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
              figure={<Pct p={p} className="font-display text-title font-extrabold leading-none stretch-condensed" />}
              figureLabel={pctLabel(p)}
              note={payoutText(per > 0 ? 1 / per : null, { points })}
            />
          );
        })}
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
              return q ? `pays ${moneyShort(q.payout, points)}` : '';
            }
            return `pays ${moneyShort(poolPreview(market, pick, stake), points)}`;
          }}
          send={(stake) => ({ type: 'place_bet', marketId: market.id, outcome: pick, stake })}
        />
      )}
    </div>
  );
}

/**
 * The phone's outcome button: the tone as a 4px rule on a deep tint, label then the number.
 * Selected = solid tone with ink text and a check. Labels wrap; 3+ outcomes stack.
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
}) {
  const t = tone(index, count);
  return (
    <button
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`${prefix ? `${prefix} ` : ''}${label}, ${figureLabel}`}
      className={cx(
        'relative flex min-h-[4.25rem] w-full min-w-0 flex-col justify-center gap-0.5 overflow-hidden rounded-tile py-2.5 pl-4 pr-3 text-left',
        'transition-[transform,background-color,color] duration-quick ease-out active:scale-[0.98] disabled:active:scale-100',
        selected ? cx(t.solid, t.ink) : cx(t.deep, 'text-chalk'),
        disabled && !selected && 'pl-dim',
      )}
    >
      {!selected && <span className={cx('absolute inset-y-0 left-0 w-1', t.rule)} aria-hidden="true" />}
      <span className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-start gap-1.5 break-words font-sans text-body font-bold leading-tight">
          {selected && <Icon name="check" size={18} strokeWidth={2.6} className="mt-px shrink-0" />}
          <span className="min-w-0">
            {prefix && <span className={cx('font-semibold', selected ? 'opacity-80' : 'text-night-400')}>{prefix} </span>}
            <span className={selected ? undefined : t.text}>{label}</span>
          </span>
        </span>
        <span className="shrink-0" aria-hidden="true">
          {figure}
        </span>
      </span>
      <span className={cx('text-cap tnum', selected ? 'opacity-80' : 'text-night-400')} aria-hidden="true">
        {note}
      </span>
    </button>
  );
}

/** Quick stake chips: one tap places, coins fly to the pot. Shared by every mode. */
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
    <div className="hd-rise mt-2 rounded-tile bg-night-850 p-3" role="group" aria-label={`Stake on ${label}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-small text-night-200">
          How much {verb === 'on' ? 'on' : verb} <span className={cx('font-bold', t.text)}>{label}</span>?
        </span>
        <button onClick={onClose} className="btn-quiet -my-1 -mr-1.5 w-11 px-0" aria-label="Cancel">
          <Icon name="x" size={20} />
        </button>
      </div>
      {chips.length ? (
        <div className={cx('mt-2 grid gap-2', chips.length >= 4 ? 'grid-cols-4' : chips.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
          {chips.map((c) => (
            <button
              key={c.amount}
              data-testid="stake-chip"
              data-stake={c.amount}
              disabled={busy !== null}
              onClick={(e) => place(c.amount, e.currentTarget)}
              aria-label={`Stake ${money(c.amount, points)}${c.isMax ? ', the most you can' : ''}, ${preview(c.amount)}`}
              className={cx(
                'flex min-h-14 flex-col items-center justify-center rounded-tile px-1 transition-[transform,background-color] duration-quick ease-out active:scale-[0.97]',
                busy === c.amount ? 'bg-flood text-flood-ink' : 'bg-night-800 text-chalk ring-1 ring-inset ring-night-600 hover:bg-night-700',
                busy !== null && busy !== c.amount && 'opacity-50',
              )}
            >
              <span className="flex items-baseline gap-1 font-display text-lead font-extrabold leading-tight stretch-condensed tnum">
                {moneyShort(c.amount, points)}
                {c.isMax && <span className="font-sans text-cap font-semibold opacity-70">max</span>}
              </span>
              <span className={cx('text-cap leading-tight tnum', busy === c.amount ? 'opacity-80' : 'text-night-400')}>
                {busy === c.amount ? 'Placing…' : preview(c.amount)}
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
          const gain = value != null ? value - h.stake : 0;
          return (
            <div key={h.outcome} className="relative overflow-hidden rounded-tile bg-night-850 py-3 pl-4 pr-3">
              <span className={cx('absolute inset-y-0 left-0 w-1', t.rule)} aria-hidden="true" />
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-small text-night-200">
                  You hold <span className="font-display font-bold text-chalk tnum">{formatShares(h.shares)}</span>{' '}
                  <span className={cx('font-bold', t.text)}>{label}</span> shares
                </span>
                {value != null && (
                  <span className={cx('flex shrink-0 items-center gap-1 font-display text-body font-bold tnum', gain >= 0 ? 'text-yes' : 'text-no')}>
                    <Icon name={gain >= 0 ? 'up' : 'down'} size={11} />
                    {pnl(gain, points)}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-cap text-night-400">
                Cost <span className="tnum text-night-200">{money(h.stake, points)}</span> · pays{' '}
                <span className="tnum text-night-200">{money(h.potential, points)}</span> if it hits
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
                  className="btn-secondary mt-3 min-h-12 w-full"
                >
                  {busy === h.outcome ? (
                    'Cashing out…'
                  ) : (
                    <>
                      Cash out now: <Money value={value} points={points} className="text-lead font-extrabold stretch-condensed" />
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

/** "Your stake $2 on Yes · pays about $2.85": stamps when it changes. */
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
    <div className="relative flex items-center justify-between gap-3 overflow-hidden rounded-tile bg-night-850 py-2.5 pl-4 pr-3">
      <span className={cx('absolute inset-y-0 left-0 w-1', t.rule)} aria-hidden="true" />
      <span className="min-w-0 text-small text-night-200">
        {lead}{' '}
        <span key={stamp} className={cx('inline-block font-display text-body font-bold text-chalk tnum', stamp && 'hd-stamp')}>
          {money(stake, points)}
        </span>{' '}
        on <span className={cx('font-bold', t.text)}>{label}</span>
      </span>
      <span className="shrink-0 text-right text-cap text-night-400">
        {payLabel} <Roll text={money(potential, points)} className="font-display text-small font-bold text-chalk" />
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ results

function ResultRow({ market, now }: { market: Market; now: number }) {
  const { client, snap, me, points } = useParty();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flagged, setFlagged] = useState(false);
  const s = market.state;
  const landed = useReplayClass(s, 'x');
  if (s === 'open') return null;
  if (s === 'locked')
    return (
      <Line icon="hourglass">
        <span className="text-night-200">Locked. Waiting for the result…</span>
      </Line>
    );
  const res = marketResult(market, snap.you?.positions ?? [], snap.fills, me);
  if (s === 'voided')
    return (
      <Line icon="refresh">
        <span className="text-night-200">
          Voided. {res.kind === 'refunded' ? `Your ${money(res.amount, points)} is back.` : 'Every stake is refunded.'}
        </span>
      </Line>
    );
  const disputeLeft = market.disputeEndsAt ? Math.ceil((Date.parse(market.disputeEndsAt) - now) / 1000) : 0;
  return (
    <div className="mt-3 border-t border-night-700 pt-3">
      <ResultBadge res={res} points={points} animate={!!landed && s === 'resolved'} big />
      {s === 'disputed' && (
        <p className="mt-2 flex items-center gap-2 text-small text-night-200">
          <Icon name="flag" size={16} className="text-night-400" /> Flagged. The host is checking the result.
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
          <span className="font-display font-bold text-night-400 tnum">{disputeLeft}&nbsp;s</span>
        </button>
      )}
      {flagged && s === 'resolved' && <p className="mt-2 text-small text-night-200">Thanks. The host will take a look.</p>}
      {error && <InlineError text={error} />}
    </div>
  );
}

/**
 * Your result on a settled market: "Called it +$0.60" (blue, check), "Cooked −$1.00" (orange, cross),
 * "Refunded". The win gets the floodlight shine when it lands.
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
  if (res.kind === 'won')
    return (
      <span className={cx('inline-flex items-center gap-1.5 rounded-chip font-bold text-yes', animate && 'hd-shine hd-stamp')}>
        <Icon name="check" size={18} strokeWidth={2.6} />
        Called it <span className={cx('font-display font-extrabold stretch-condensed tnum', size)}>{pnl(res.amount, points)}</span>
      </span>
    );
  if (res.kind === 'lost')
    return (
      <span className={cx('inline-flex items-center gap-1.5 font-bold text-no', animate && 'hd-stamp')}>
        <Icon name="x" size={18} strokeWidth={2.6} />
        Cooked <span className={cx('font-display font-extrabold stretch-condensed tnum', size)}>{pnl(-res.amount, points)}</span>
      </span>
    );
  if (res.kind === 'refunded')
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-night-200">
        <Icon name="refresh" size={16} /> Refunded {money(res.amount, points)}
      </span>
    );
  return <span className="text-small text-night-400">You sat this one out.</span>;
}

function Line({ icon, children }: { icon: 'hourglass' | 'refresh'; children: ReactNode }) {
  return (
    <p className="mt-3 flex items-center gap-2 border-t border-night-700 pt-3 text-small">
      <Icon name={icon} size={16} className="shrink-0 text-night-400" />
      {children}
    </p>
  );
}
