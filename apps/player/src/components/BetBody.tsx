import { defaultOddsForPrior, MAX_ODDS, MIN_ODDS, remainingTakerCapacity, roundOdds, takerStakeFor, type BetOffer, type Market } from '@huddle/shared';
import { AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { backQuote, holdingsFor, maxStake, myOffers, returnAt, stakeChips, takeableOffers, takerOdds, takerWin } from '../lib/markets';
import { money, moneyShort } from '../lib/money';
import { act, cx, useParty } from './ctx';
import { Icon, Spinner } from './Icon';
import { InlineError, StakeTray, toneFor, useNotify } from './MarketCard';
import { Sheet } from './primitives';

/** Head-to-head mode: one-tap back (D10), friends' offers, and your own odds. */
export function BetBody({ market, live }: { market: Market; live: boolean }) {
  const { client, snap, me, points } = useParty();
  const [pick, setPick] = useState<string | null>(null);
  const [taking, setTaking] = useState<BetOffer | null>(null);
  const [offering, setOffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offers = takeableOffers(market.id, snap.offers, me);
  const mine = myOffers(market.id, snap.offers, me);
  const holdings = holdingsFor(market, snap.you?.positions ?? []);
  const label = (id: string) => market.outcomes.find((o) => o.id === id)?.label ?? id;
  const idxOf = (id: string) => market.outcomes.findIndex((o) => o.id === id);
  const other = (side: string) =>
    market.outcomes.length === 2 ? label(market.outcomes.find((o) => o.id !== side)!.id) : `not ${label(side)}`;

  return (
    <div>
      <div className={cx('grid gap-2.5', market.outcomes.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {market.outcomes.map((o, i) => {
          const q = backQuote(market, o.id, snap.offers, me);
          const tone = toneFor(i);
          const selected = pick === o.id;
          const won = market.outcome === o.id && market.state !== 'voided';
          return (
            <button
              key={o.id}
              disabled={!live}
              onClick={() => setPick(selected ? null : o.id)}
              aria-pressed={selected}
              className={cx(
                'min-h-[84px] rounded-2xl border px-3 pb-3 pt-2.5 text-left transition-transform active:scale-[0.97] disabled:active:scale-100',
                selected ? cx(tone.solid, 'border-transparent') : cx(tone.soft, tone.border),
                !live && !won && 'opacity-60',
                won && 'ring-2 ring-volt',
              )}
            >
              <div className={cx('text-xs font-semibold uppercase tracking-wider', selected ? 'opacity-80' : 'text-pitch-400')}>Back</div>
              <div className={cx('font-display text-lg font-bold uppercase leading-tight', selected ? '' : tone.text)}>{o.label}</div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-[30px] font-bold leading-none tnum">{q.odds.toFixed(2)}</span>
                <span className={cx('text-[11px]', selected ? 'opacity-75' : 'text-pitch-400')}>
                  {q.matchesOffer ? `vs ${q.makerName ?? 'a friend'}` : 'fair odds'}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <AnimatePresence initial={false}>
        {pick && live && (
          <StakeTray
            key={pick}
            market={market}
            outcome={pick}
            verb="backing"
            onClose={() => setPick(null)}
            preview={(stake) => `returns ${moneyShort(returnAt(stake, backQuote(market, pick, snap.offers, me).odds), points)}`}
            send={(stake) => ({ type: 'place_bet', marketId: market.id, outcome: pick, stake })}
          />
        )}
      </AnimatePresence>

      {holdings.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {holdings.map((h) => (
            <div key={h.outcome} className="flex items-center justify-between rounded-2xl border border-pitch-700 bg-pitch-800/70 px-3 py-2.5 text-sm">
              <span className="text-pitch-200">
                Matched: <span className="tnum font-semibold text-pitch-50">{money(h.stake, points)}</span> on{' '}
                <span className={cx('font-semibold', toneFor(idxOf(h.outcome)).text)}>{label(h.outcome)}</span>
              </span>
              <span className="text-xs text-pitch-400">
                returns <span className="tnum text-pitch-200">{money(h.potential, points)}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {(offers.length > 0 || mine.length > 0) && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-pitch-400">Offers in the room</div>
          {offers.slice(0, 4).map((o) => (
            <div key={o.id} className="flex items-center gap-3 rounded-2xl bg-pitch-800/70 py-2 pl-3 pr-2">
              <Avatar name={o.makerName ?? '?'} />
              <div className="min-w-0 flex-1 text-sm leading-snug">
                <div className="truncate text-pitch-50">
                  <b>{o.makerName ?? 'A friend'}</b> offers <span className="font-display text-base font-bold tnum">{o.odds.toFixed(2)}</span> on{' '}
                  <span className={cx('font-semibold', toneFor(idxOf(o.side)).text)}>{label(o.side)}</span>
                </div>
                <div className="truncate text-xs text-pitch-400">
                  You back {other(o.side)} at <span className="tnum">{takerOdds(o.odds).toFixed(2)}</span> · up to {money(remainingTakerCapacity(o), points)}
                </div>
              </div>
              <button
                disabled={!live}
                onClick={() => setTaking(o)}
                className="min-h-[44px] shrink-0 rounded-xl bg-volt px-3.5 text-sm font-bold text-volt-ink active:scale-95 disabled:opacity-40"
              >
                Take it
              </button>
            </div>
          ))}
          {mine.map((o) => (
            <div key={o.id} className="flex items-center gap-3 rounded-2xl border border-dashed border-pitch-600 py-2 pl-3 pr-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="text-pitch-50">
                  Your offer: {money(o.makerStake, points)} on <span className={cx('font-semibold', toneFor(idxOf(o.side)).text)}>{label(o.side)}</span> at{' '}
                  <span className="tnum">{o.odds.toFixed(2)}</span>
                </div>
                <div className="text-xs text-pitch-400 tnum">
                  {o.filled ? `${money(o.filled, points)} matched · ` : ''}waiting for a taker
                </div>
              </div>
              <button
                onClick={async () => {
                  setError(await act(client, { type: 'cancel_offer', offerId: o.id }));
                }}
                className="min-h-[44px] shrink-0 rounded-xl px-3 text-sm font-semibold text-pitch-200 active:bg-pitch-800"
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}

      {live && (
        <button
          onClick={() => setOffering(true)}
          className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-pitch-600 text-sm font-semibold text-pitch-200 active:bg-pitch-800"
        >
          <Icon name="plus" size={16} /> Offer your own odds
        </button>
      )}
      {error && <InlineError text={error} />}

      <TakeSheet market={market} offer={taking} onClose={() => setTaking(null)} sideLabel={taking ? other(taking.side) : ''} />
      <OfferSheet market={market} open={offering} onClose={() => setOffering(false)} />
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pitch-700 font-display text-lg font-bold uppercase text-pitch-200">
      {name.slice(0, 1)}
    </span>
  );
}

function TakeSheet({ market, offer, onClose, sideLabel }: { market: Market; offer: BetOffer | null; onClose: () => void; sideLabel: string }) {
  const { client, snap, balance, points } = useParty();
  const notify = useNotify();
  const [amount, setAmount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cap = offer ? remainingTakerCapacity(offer) : 0;
  const chips = offer ? stakeChips(balance, snap.party.config, cap) : [];
  const chosen = amount ?? chips[chips.length - 1]?.amount ?? 0;
  const win = offer ? takerWin(offer, chosen) : 0;

  const close = () => {
    setAmount(null);
    setError(null);
    onClose();
  };

  return (
    <Sheet open={!!offer} onClose={close} title="Take the bet">
      {offer && (
        <div className="space-y-4">
          <p className="text-pitch-200">
            <b className="text-pitch-50">{offer.makerName ?? 'A friend'}</b> backs {market.outcomes.find((o) => o.id === offer.side)?.label} at{' '}
            {offer.odds.toFixed(2)}. You take <b className="text-pitch-50">{sideLabel}</b>.
          </p>
          <div className="text-sm text-pitch-400">{market.question}</div>
          {chips.length ? (
            <div className="grid grid-cols-4 gap-2">
              {chips.map((c) => (
                <button
                  key={c.amount}
                  onClick={() => setAmount(c.amount)}
                  className={cx(
                    'min-h-[52px] rounded-xl font-display text-xl font-bold tnum',
                    chosen === c.amount ? 'bg-volt text-volt-ink' : 'bg-pitch-800 text-pitch-50',
                  )}
                >
                  {c.isMax ? 'Max' : moneyShort(c.amount, points)}
                </button>
              ))}
            </div>
          ) : (
            <InlineError text="Not enough balance to take this one." />
          )}
          <div className="flex items-center justify-between rounded-2xl bg-pitch-800 px-4 py-3">
            <div>
              <div className="text-xs text-pitch-400">You stake</div>
              <div className="font-display text-2xl font-bold tnum">{money(chosen, points)}</div>
            </div>
            <Icon name="up" className="rotate-90 text-pitch-600" />
            <div className="text-right">
              <div className="text-xs text-pitch-400">You win</div>
              <div className="font-display text-2xl font-bold text-up tnum">{money(win, points)}</div>
            </div>
          </div>
          <button
            disabled={busy || !chosen}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const err = await act(client, { type: 'take_offer', offerId: offer.id, amount: chosen });
              setBusy(false);
              if (err) return setError(err);
              notify(`Bet's on: ${money(chosen, points)} to win ${money(win, points)}`, 'win');
              close();
            }}
            className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-volt font-display text-xl font-bold uppercase tracking-wide text-volt-ink shadow-glow active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? <Spinner /> : `Take it · ${moneyShort(chosen, points)}`}
          </button>
          {error && <InlineError text={error} />}
        </div>
      )}
    </Sheet>
  );
}

function OfferSheet({ market, open, onClose }: { market: Market; open: boolean; onClose: () => void }) {
  const { client, snap, balance, points } = useParty();
  const notify = useNotify();
  const [side, setSide] = useState(market.outcomes[0]!.id);
  const [odds, setOdds] = useState<number | null>(null);
  const [stake, setStake] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chips = stakeChips(balance, snap.party.config);
  const theOdds = odds ?? defaultOddsForPrior(market.prior[side] ?? 0.5);
  const theStake = stake ?? Math.min(chips[0]?.amount ?? 0, maxStake(balance, snap.party.config));
  const sideLabel = market.outcomes.find((o) => o.id === side)?.label ?? side;
  const step = (d: number) => setOdds(roundOdds(Math.min(MAX_ODDS, Math.max(MIN_ODDS, theOdds + d))));

  return (
    <Sheet open={open} onClose={onClose} title="Offer your odds">
      <div className="space-y-4">
        <div className="text-sm text-pitch-400">{market.question}</div>
        <div className={cx('grid gap-2', market.outcomes.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
          {market.outcomes.map((o, i) => (
            <button
              key={o.id}
              onClick={() => {
                setSide(o.id);
                setOdds(null);
              }}
              className={cx(
                'min-h-[48px] rounded-xl border font-display text-lg font-bold uppercase',
                side === o.id ? cx(toneFor(i).solid, 'border-transparent') : cx(toneFor(i).soft, toneFor(i).border, toneFor(i).text),
              )}
            >
              I back {o.label}
            </button>
          ))}
        </div>
        <div>
          <div className="mb-1.5 text-xs uppercase tracking-wider text-pitch-400">Your stake</div>
          <div className="grid grid-cols-4 gap-2">
            {chips.map((c) => (
              <button
                key={c.amount}
                onClick={() => setStake(c.amount)}
                className={cx('min-h-[48px] rounded-xl font-display text-lg font-bold tnum', theStake === c.amount ? 'bg-volt text-volt-ink' : 'bg-pitch-800')}
              >
                {c.isMax ? 'Max' : moneyShort(c.amount, points)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs uppercase tracking-wider text-pitch-400">Your odds</div>
          <div className="flex items-center justify-between rounded-2xl bg-pitch-800 p-1.5">
            <button onClick={() => step(-0.05)} className="grid h-12 w-12 place-items-center rounded-xl bg-pitch-700 active:scale-95" aria-label="Lower odds">
              <Icon name="minus" />
            </button>
            <div className="text-center">
              <div className="font-display text-4xl font-bold tnum">{theOdds.toFixed(2)}</div>
              <div className="text-[11px] text-pitch-400">fair: {defaultOddsForPrior(market.prior[side] ?? 0.5).toFixed(2)}</div>
            </div>
            <button onClick={() => step(0.05)} className="grid h-12 w-12 place-items-center rounded-xl bg-pitch-700 active:scale-95" aria-label="Raise odds">
              <Icon name="plus" />
            </button>
          </div>
        </div>
        <p className="text-sm text-pitch-200">
          If <b>{sideLabel}</b> hits you get <b className="tnum text-up">{money(returnAt(theStake, theOdds), points)}</b> back. A friend needs{' '}
          <b className="tnum">{money(takerStakeFor(theStake, theOdds), points)}</b> to take it.
        </p>
        <button
          disabled={busy || theStake <= 0}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const err = await act(client, { type: 'post_offer', marketId: market.id, side, makerStake: theStake, odds: theOdds });
            setBusy(false);
            if (err) return setError(err);
            notify(`Offer posted: ${moneyShort(theStake, points)} on ${sideLabel} at ${theOdds.toFixed(2)}`, 'info');
            onClose();
          }}
          className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-volt font-display text-xl font-bold uppercase tracking-wide text-volt-ink shadow-glow active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? <Spinner /> : 'Post offer'}
        </button>
        {error && <InlineError text={error} />}
      </div>
    </Sheet>
  );
}
