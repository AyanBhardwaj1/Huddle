import { defaultOddsForPrior, MAX_ODDS, MIN_ODDS, remainingTakerCapacity, roundOdds, takerStakeFor, type BetOffer, type Market } from '@huddle/shared';
import { Icon, Roll } from '@huddle/ui';
import { useState } from 'react';
import { backQuote, holdingsFor, maxStake, myOffers, returnAt, stakeChips, takeableOffers, takerOdds, takerWin } from '../lib/markets';
import { money, moneyShort } from '../lib/money';
import { act, cx, useParty } from './ctx';
import { OutcomeButton, StakeRow, StakeTray, useNotify, type CardFlow } from './MarketCard';
import { Avatar, InlineError, Sheet } from './primitives';
import { tone } from './tones';

const odds2 = (x: number) => x.toFixed(2);

/** Head-to-head: one-tap back at fair odds (D10), friends' offers to take, and your own odds. */
export function BetBody({ market, live, flow }: { market: Market; live: boolean; flow?: CardFlow }) {
  const { client, snap, me, points } = useParty();
  const [pick, setPick] = useState<string | null>(null);
  const [taking, setTaking] = useState<BetOffer | null>(null);
  const [offering, setOffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const offers = takeableOffers(market.id, snap.offers, me);
  const mine = myOffers(market.id, snap.offers, me);
  const holdings = holdingsFor(market, snap.you?.positions ?? []);
  const n = market.outcomes.length;
  const label = (id: string) => market.outcomes.find((o) => o.id === id)?.label ?? id;
  const idxOf = (id: string) => market.outcomes.findIndex((o) => o.id === id);
  const other = (side: string) => (n === 2 ? label(market.outcomes.find((o) => o.id !== side)!.id) : `not ${label(side)}`);
  const settled = market.state !== 'open' && market.state !== 'locked';

  return (
    <div>
      {!settled && (
        <div className={cx('gap-2', n === 2 ? 'grid grid-cols-2' : 'flex flex-col')}>
          {market.outcomes.map((o, i) => {
            const q = backQuote(market, o.id, snap.offers, me);
            return (
              <OutcomeButton
                key={o.id}
                label={o.label}
                prefix="Back"
                index={i}
                count={n}
                selected={pick === o.id}
                disabled={!live}
                onClick={() => setPick(pick === o.id ? null : o.id)}
                figure={<Roll text={odds2(q.odds)} className="font-display text-title font-extrabold leading-none stretch-condensed" />}
                figureLabel={`odds ${odds2(q.odds)}${q.matchesOffer ? `, against ${q.makerName ?? 'a friend'}` : ', fair odds'}`}
                note={q.matchesOffer ? `Matches ${q.makerName ?? 'a friend'}` : 'Fair odds'}
              />
            );
          })}
        </div>
      )}

      {pick && live && (
        <StakeTray
          key={pick}
          market={market}
          outcome={pick}
          verb="backing"
          flow={flow}
          onClose={() => setPick(null)}
          preview={(stake) => `pays ${moneyShort(returnAt(stake, backQuote(market, pick, snap.offers, me).odds), points)}`}
          send={(stake) => ({ type: 'place_bet', marketId: market.id, outcome: pick, stake })}
        />
      )}

      {holdings.length > 0 && !settled && (
        <div className="mt-3 space-y-2">
          {holdings.map((h) => (
            <StakeRow key={h.outcome} lead="Matched" payLabel="returns" stake={h.stake} potential={h.potential} label={label(h.outcome)} toneIndex={idxOf(h.outcome)} count={n} />
          ))}
        </div>
      )}

      {!settled && (offers.length > 0 || mine.length > 0) && (
        <section className="mt-4" aria-label="Offers in the room">
          <h4 className="mb-1 text-small text-ink-muted">Offers in the room</h4>
          <ul className="divide-y divide-rule">
            {offers.slice(0, 4).map((o) => {
              const t = tone(idxOf(o.side), n);
              return (
                <li key={o.id} className="hd-fade flex items-center gap-3 py-2.5">
                  <Avatar name={o.makerName ?? '?'} />
                  <div className="min-w-0 flex-1 leading-snug">
                    <p className="text-small text-ink">
                      <b>{o.makerName ?? 'A friend'}</b> backs <span className={cx('font-bold', t.text)}>{label(o.side)}</span> at{' '}
                      <span className="font-display font-bold tnum">{odds2(o.odds)}</span>
                    </p>
                    <p className="text-cap text-ink-muted">
                      You'd back {other(o.side)} at <span className="font-display font-bold text-ink-2 tnum">{odds2(takerOdds(o.odds))}</span>, up to{' '}
                      <span className="tnum">{money(remainingTakerCapacity(o), points)}</span>
                    </p>
                  </div>
                  <button disabled={!live} onClick={() => setTaking(o)} className="btn-secondary shrink-0 px-4">
                    Take it
                  </button>
                </li>
              );
            })}
            {mine.map((o) => {
              const t = tone(idxOf(o.side), n);
              return (
                <li key={o.id} className="flex items-center gap-3 py-2.5">
                  <Avatar name="You" className="bg-canvas text-zap" />
                  <div className="min-w-0 flex-1 leading-snug">
                    <p className="text-small text-ink">
                      Your offer: <span className="font-display font-bold tnum">{money(o.makerStake, points)}</span> on{' '}
                      <span className={cx('font-bold', t.text)}>{label(o.side)}</span> at <span className="font-display font-bold tnum">{odds2(o.odds)}</span>
                    </p>
                    <p className="text-cap text-ink-muted tnum">
                      {o.filled ? `${money(o.filled, points)} matched, ` : ''}waiting for a taker
                    </p>
                  </div>
                  <button
                    disabled={cancelling === o.id}
                    onClick={async () => {
                      setCancelling(o.id);
                      setError(await act(client, { type: 'cancel_offer', offerId: o.id }));
                      setCancelling(null);
                    }}
                    className="btn-quiet shrink-0"
                  >
                    {cancelling === o.id ? 'Cancelling…' : 'Cancel'}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {live && (
        <button onClick={() => setOffering(true)} className="btn-quiet mt-2 w-full bg-canvas">
          <Icon name="plus" size={18} /> Offer your own odds
        </button>
      )}
      {error && <InlineError text={error} />}

      <TakeSheet market={market} offer={taking} onClose={() => setTaking(null)} sideLabel={taking ? other(taking.side) : ''} />
      <OfferSheet market={market} open={offering} onClose={() => setOffering(false)} />
    </div>
  );
}

/** Choice chips inside sheets: the chosen one fills zap. */
function Chips({ amounts, chosen, onPick, points }: { amounts: { amount: number; isMax: boolean }[]; chosen: number; onPick: (a: number) => void; points: boolean }) {
  return (
    <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Stake">
      {amounts.map((c) => (
        <button
          key={c.amount}
          role="radio"
          aria-checked={chosen === c.amount}
          onClick={() => onPick(c.amount)}
          className={cx(
            'flex min-h-12 flex-col items-center justify-center rounded-tile font-display text-lead font-extrabold leading-tight stretch-condensed tnum transition-colors duration-quick',
            chosen === c.amount ? 'bg-zap text-zap-ink' : 'bg-well text-ink ring-1 ring-inset ring-rule hover:bg-control',
          )}
        >
          {moneyShort(c.amount, points)}
          {c.isMax && <span className="font-sans text-cap font-semibold opacity-70">max</span>}
        </button>
      ))}
    </div>
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
        <div className="space-y-5">
          <div>
            <p className="text-small text-ink-muted">{market.question}</p>
            <p className="mt-1 text-body text-ink-2">
              <b className="text-ink">{offer.makerName ?? 'A friend'}</b> backs {market.outcomes.find((o) => o.id === offer.side)?.label} at{' '}
              <span className="font-display font-bold tnum">{odds2(offer.odds)}</span>. You take <b className="text-ink">{sideLabel}</b> at{' '}
              <span className="font-display font-bold tnum">{odds2(takerOdds(offer.odds))}</span>.
            </p>
          </div>
          {chips.length ? (
            <Chips amounts={chips} chosen={chosen} onPick={setAmount} points={points} />
          ) : (
            <InlineError text="Not enough balance to take this one. Add more from your balance at the top." />
          )}
          <div className="grid grid-cols-2 divide-x divide-rule rounded-tile bg-canvas py-3">
            <div className="px-4">
              <div className="text-cap text-ink-muted">You stake</div>
              <Roll text={money(chosen, points)} className="font-display text-title font-extrabold stretch-condensed" />
            </div>
            <div className="px-4">
              <div className="text-cap text-ink-muted">You win</div>
              <Roll text={money(win, points)} className="font-display text-title font-extrabold text-yes-600 stretch-condensed" />
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
            className="btn-primary w-full shadow-zap"
          >
            {busy ? 'Taking it…' : `Take it for ${moneyShort(chosen, points)}`}
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
  const fair = defaultOddsForPrior(market.prior[side] ?? 0.5);
  const theOdds = odds ?? fair;
  const theStake = stake ?? Math.min(chips[0]?.amount ?? 0, maxStake(balance, snap.party.config));
  const sideLabel = market.outcomes.find((o) => o.id === side)?.label ?? side;
  const step = (d: number) => setOdds(roundOdds(Math.min(MAX_ODDS, Math.max(MIN_ODDS, theOdds + d))));
  const n = market.outcomes.length;

  return (
    <Sheet open={open} onClose={onClose} title="Offer your odds">
      <div className="space-y-5">
        <p className="text-small text-ink-muted">{market.question}</p>
        <div className={cx('gap-2', n === 2 ? 'grid grid-cols-2' : 'flex flex-col')} role="radiogroup" aria-label="Your side">
          {market.outcomes.map((o, i) => {
            const t = tone(i, n);
            const on = side === o.id;
            return (
              <button
                key={o.id}
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setSide(o.id);
                  setOdds(null);
                }}
                className={cx(
                  'relative flex min-h-12 items-center gap-2 overflow-hidden rounded-tile pl-4 pr-3 text-left font-bold transition-colors duration-quick',
                  on ? cx(t.solid, t.ink) : cx(t.deep, 'text-ink'),
                )}
              >
                {!on && <span className={cx('absolute inset-y-0 left-0 w-1', t.rule)} aria-hidden="true" />}
                {on && <Icon name="check" size={18} strokeWidth={2.6} />}I back <span className={on ? undefined : t.text}>{o.label}</span>
              </button>
            );
          })}
        </div>
        <div>
          <p className="mb-2 text-small text-ink-2">Your stake</p>
          <Chips amounts={chips} chosen={theStake} onPick={setStake} points={points} />
        </div>
        <div>
          <p className="mb-2 text-small text-ink-2">Your odds</p>
          <div className="flex items-center justify-between gap-2 rounded-tile bg-canvas p-1.5">
            <button onClick={() => step(-0.05)} className="btn-secondary h-12 w-12 px-0" aria-label="Lower odds">
              <Icon name="minus" size={20} />
            </button>
            <div className="text-center">
              <Roll text={odds2(theOdds)} className="font-display text-head font-extrabold stretch-condensed" />
              <div className="text-cap text-ink-muted">
                Fair is <span className="tnum">{odds2(fair)}</span>
              </div>
            </div>
            <button onClick={() => step(0.05)} className="btn-secondary h-12 w-12 px-0" aria-label="Raise odds">
              <Icon name="plus" size={20} />
            </button>
          </div>
        </div>
        <p className="text-pretty text-small text-ink-2">
          If <b className="text-ink">{sideLabel}</b> hits you get <b className="font-display text-yes-600 tnum">{money(returnAt(theStake, theOdds), points)}</b> back. A
          friend puts in <b className="font-display text-ink tnum">{money(takerStakeFor(theStake, theOdds), points)}</b> to take it.
        </p>
        <button
          disabled={busy || theStake <= 0}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const err = await act(client, { type: 'post_offer', marketId: market.id, side, makerStake: theStake, odds: theOdds });
            setBusy(false);
            if (err) return setError(err);
            notify(`Offer posted: ${moneyShort(theStake, points)} on ${sideLabel} at ${odds2(theOdds)}`, 'info');
            onClose();
          }}
          className="btn-primary w-full shadow-zap"
        >
          {busy ? 'Posting…' : `Post ${moneyShort(theStake, points)} at ${odds2(theOdds)}`}
        </button>
        {error && <InlineError text={error} />}
      </div>
    </Sheet>
  );
}
