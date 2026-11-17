import type { AnnouncerLine, GameState, Market, Party, PlayerPublic } from '@huddle/shared';
import { Icon, LockRing, MarkerShape, Pct, pctText, Roll, SplitBar, SplitMarkers, toneFor, useReplayClass, type Tone } from "@huddle/ui";
import { motion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';
import {
  countdown,
  leaderboard,
  MODE_LABEL,
  moneyShort,
  payoutLine,
  prosRow,
  roomProb,
  tickerItems,
  type ResultSummary,
} from '../lib/derive';
import { useNow, useParty } from '../party';
import { useBox } from '../store';

const TONE_TEXT: Record<Tone, string> = { yes: 'text-yes', no: 'text-no', other: 'text-other', 'other-alt': 'text-other' };
const TONE_SWATCH: Record<Tone, string> = { yes: 'hd-tone-yes', no: 'hd-tone-no', other: 'hd-tone-other', 'other-alt': 'hd-tone-other-alt' };
const delay = (ms: number) => ({ ['--d' as string]: `${ms}ms` }) as CSSProperties;

/* ---------------- Top bar: scorebug + join + controls ---------------- */

function TeamScore({ name, short, color, score, side }: { name: string; short: string; color?: string; score: number; side: 'home' | 'away' }) {
  const stamp = useReplayClass(score, 'hd-beat');
  return (
    <div className={`flex items-center gap-3 ${side === 'away' ? 'flex-row-reverse' : ''}`}>
      <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: color ?? '#87909B' }} aria-hidden="true" />
      <span className="font-display text-title font-extrabold leading-none" style={{ fontStretch: '100%' }} title={name}>
        {short}
      </span>
      <span className={`num inline-block min-w-[1.4ch] text-center text-[2.4rem] leading-none ${stamp}`}>{score}</span>
    </div>
  );
}

export function Scorebug({ game, party }: { game: GameState; party: Party }) {
  const live = game.status === 'live';
  return (
    <div className="flex items-center gap-4" aria-label={`${game.home.name} ${game.score.home}, ${game.away.name} ${game.score.away}, ${game.clock.display}`}>
      <TeamScore name={game.home.name} short={game.home.short} color={game.home.color} score={game.score.home} side="home" />
      <div className="flex min-w-[4.5rem] flex-col items-center leading-none">
        <span className="num text-title">{game.clock.display}</span>
        <span className="mt-1 flex items-center gap-1.5 text-small text-night-400">
          {live ? (
            <>
              <span className="h-2 w-2 rounded-full bg-live" aria-hidden="true" />
              {party.game.status === 'replay' ? 'Replay' : 'Live'}
            </>
          ) : game.status === 'final' ? (
            'Full time'
          ) : (
            'Pre-game'
          )}
        </span>
      </div>
      <TeamScore name={game.away.name} short={game.away.short} color={game.away.color} score={game.score.away} side="away" />
    </div>
  );
}

export function TopBar({ left, middle, right }: { left: ReactNode; middle?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex h-[3.75rem] items-center gap-4 border-b border-night-700 px-4">
      <div className="flex shrink-0 items-center">{left}</div>
      <div className="flex min-w-0 flex-1 items-center justify-center">{middle}</div>
      <div className="flex shrink-0 items-center gap-2">{right}</div>
    </header>
  );
}

/* ---------------- Outcome numbers ---------------- */

function OutcomeFigure({
  market,
  index,
  align,
  size,
  party,
}: {
  market: Market;
  index: number;
  align: 'start' | 'end' | 'center';
  size: 'hero' | 'big' | 'display';
  party: Party | undefined;
}) {
  const o = market.outcomes[index]!;
  const tone = toneFor(index, market.outcomes.length);
  const prob = roomProb(market, o.id);
  const pool = market.pool?.[o.id];
  const alignCls = align === 'end' ? 'items-end text-right' : align === 'center' ? 'items-center text-center' : 'items-start text-left';
  return (
    <div className={`flex min-w-0 flex-col ${alignCls}`}>
      <span className={`flex max-w-full items-center gap-2 text-title font-bold leading-tight ${TONE_TEXT[tone]}`}>
        {align !== 'end' && <span className={`h-3 w-3 shrink-0 rounded-[3px] ${TONE_SWATCH[tone]}`} aria-hidden="true" />}
        <span className="line-clamp-2 min-w-0 break-words">{o.label}</span>
        {align === 'end' && <span className={`h-3 w-3 shrink-0 rounded-[3px] ${TONE_SWATCH[tone]}`} aria-hidden="true" />}
      </span>
      <span className={`num leading-[0.9] ${size === 'hero' ? 'text-hero' : size === 'big' ? 'text-[4.5rem]' : 'text-display'}`}>
        <Pct p={prob} arrow />
      </span>
      <span className="text-body text-night-200">
        {market.mode === 'pool' && pool !== undefined ? `${moneyShort(pool, party)} in the pool` : payoutLine(prob, party)}
      </span>
    </div>
  );
}

/** Model / Gemini on the same axis as the room: notches over the split + a spoken legend. */
function ProsLegend({ market }: { market: Market }) {
  const row = prosRow(market);
  if (!row) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-body text-night-200">
      <span>
        Room <b className="num text-lead text-chalk">{pctText(row.room)}%</b> on {row.outcomeLabel}
      </span>
      <span className="flex items-center gap-1.5">
        <MarkerShape shape="solid" className="text-night-200" />
        Model <b className="num text-lead text-chalk">{pctText(row.model)}%</b>
      </span>
      {row.gemini !== undefined && (
        <span className="flex items-center gap-1.5">
          <MarkerShape shape="hollow" className="text-night-200" />
          Gemini <b className="num text-lead text-chalk">{pctText(row.gemini)}%</b>
        </span>
      )}
    </p>
  );
}

function marketSplit(market: Market) {
  return market.outcomes.map((o) => ({ id: o.id, label: o.label, p: roomProb(market, o.id) }));
}

/** Notch positions on the split are cumulative: the pros' number for the first outcome. */
function prosMarkers(market: Market) {
  const row = prosRow(market);
  if (!row) return [];
  const idx = market.outcomes.findIndex((o) => o.label === row.outcomeLabel);
  // Position = start of that outcome's segment + its probability (only meaningful for the 1st one).
  if (idx !== 0) return [];
  const m: { id: string; label: string; p: number; shape: 'solid' | 'hollow' }[] = [
    { id: 'model', label: 'Model', p: row.model, shape: 'solid' },
  ];
  if (row.gemini !== undefined) m.push({ id: 'gemini', label: 'Gemini', p: row.gemini, shape: 'hollow' });
  return m;
}

/* ---------------- Moment market takeover ---------------- */

export function MomentStage({ market, compact = false, tight = false }: { market: Market; compact?: boolean; tight?: boolean }) {
  const party = useParty();
  const p = party.view.snapshot?.party;
  const now = useNow(100);
  const cd = countdown(market, now, p?.config.momentLockSecs);
  const locked = market.state !== 'open';
  const lockState = locked ? 'locked' : !cd ? 'manual' : cd.urgent ? 'urgent' : 'open';
  const flash = useReplayClass(locked, 'flash');
  const n = market.outcomes.length;
  const binary = n === 2;
  return (
    <section
      className={`relative flex h-full min-h-0 flex-col overflow-hidden rounded-panel bg-night-900 px-7 pb-4 pt-4 ${locked ? 'is-locked' : ''}`}
      aria-label="Moment market"
    >
      <div className="hd-wipe" aria-hidden="true" />
      {flash && locked && <div key={flash} className="hd-flashout absolute inset-0 z-10 bg-chalk" aria-hidden="true" />}
      <div className="flex min-h-0 flex-1 gap-7">
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="hd-fade flex flex-wrap items-center gap-x-2 text-body text-night-400 [&>span]:whitespace-nowrap">
            {locked ? (
              <span className="flex items-center gap-1.5 font-semibold text-chalk">
                <Icon name="lock" className="h-[1em] w-[1em]" /> Locked, waiting for the result
              </span>
            ) : (
              <span className="flex items-center gap-2 font-semibold text-flood">
                <span className="hd-breathe h-2.5 w-2.5 rounded-full bg-flood" aria-hidden="true" />
                Moment market
              </span>
            )}
            <span>· {MODE_LABEL[market.mode]} mode</span>
            {!compact && <span className="tnum">· {moneyShort(market.volume, p)} traded</span>}
          </p>
          <h1
            className={`q hd-rise mt-2 line-clamp-3 shrink-0 leading-[1.02] ${compact || tight ? 'text-[2.1rem]' : 'text-[2.6rem]'}`}
            style={delay(120)}
          >
            {market.question}
          </h1>
          <div className="mt-auto flex flex-col gap-2 pt-3">
            {binary ? (
              <div className="hd-rise flex items-end justify-between gap-6" style={delay(200)}>
                <OutcomeFigure market={market} index={0} align="start" size={compact ? 'display' : tight ? 'big' : 'hero'} party={p} />
                <OutcomeFigure market={market} index={1} align="end" size={compact ? 'display' : tight ? 'big' : 'hero'} party={p} />
              </div>
            ) : (
              <div className="hd-rise grid gap-5" style={{ ...delay(200), gridTemplateColumns: `repeat(${Math.min(n, 4)}, minmax(0, 1fr))` }}>
                {market.outcomes.slice(0, 4).map((o, i) => (
                  <OutcomeFigure key={o.id} market={market} index={i} align="start" size="display" party={p} />
                ))}
              </div>
            )}
            <div className="hd-fade" style={delay(260)}>
              <SplitMarkers className="text-lead text-night-200" markers={prosMarkers(market)} />
              <SplitBar className="h-5 rounded-chip" parts={marketSplit(market)} />
            </div>
            <div className={`hd-fade ${compact ? 'hidden' : ''}`} style={delay(320)}>
              <ProsLegend market={market} />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center justify-center">
          <LockRing
            fraction={cd ? cd.fraction : null}
            label={cd ? cd.label : null}
            state={lockState}
            size={compact ? '9.5rem' : '12rem'}
            caption={lockState === 'manual' ? 'Locks on the play' : lockState === 'urgent' ? <span className="font-bold text-chalk">Last call</span> : <span className="text-night-200">to lock</span>}
          />
        </div>
      </div>
    </section>
  );
}

/* ---------------- Game-long markets ---------------- */

function GameCell({ market, big }: { market: Market; big: boolean }) {
  const party = useParty();
  const p = party.view.snapshot?.party;
  const settled = market.state === 'resolved' || market.state === 'final';
  const n = market.outcomes.length;
  return (
    <article className="hd-rise flex min-h-0 min-w-0 flex-col gap-2 px-5 py-4" aria-label={market.question}>
      <p className="flex items-center gap-2 text-small text-night-400">
        {market.state === 'open' && <span>{MODE_LABEL[market.mode]} · all game</span>}
        {market.state === 'locked' && (
          <span className="flex items-center gap-1.5 font-semibold text-chalk">
            <Icon name="lock" className="h-[1em] w-[1em]" /> Locked
          </span>
        )}
        {market.state === 'disputed' && (
          <span className="flex items-center gap-1.5 font-semibold text-no-bright">
            <Icon name="flag" className="h-[1em] w-[1em]" /> Result disputed
          </span>
        )}
        {settled && (
          <span className="flex items-center gap-1.5 font-semibold text-chalk">
            <Icon name="check" className="h-[1em] w-[1em]" /> Settled
          </span>
        )}
        <span className="tnum ml-auto">{moneyShort(market.volume, p)} traded</span>
      </p>
      <h2 className={`q line-clamp-2 leading-[1.05] ${big ? 'text-head' : 'text-title'}`}>{market.question}</h2>
      <SplitBar className="mt-1 h-2.5 shrink-0 rounded-full" parts={marketSplit(market)} />
      <ul className={`flex flex-col gap-0.5 ${big ? 'my-auto' : 'mt-1'}`}>
        {market.outcomes.slice(0, 4).map((o, i) => {
          const tone = toneFor(i, n);
          const won = settled && market.outcome === o.id;
          return (
            <li key={o.id} className="flex items-baseline gap-2.5">
              <span className={`h-2.5 w-2.5 shrink-0 self-center rounded-[3px] ${TONE_SWATCH[tone]}`} aria-hidden="true" />
              <span className={`min-w-0 flex-1 truncate text-lead ${won ? 'font-bold text-chalk' : 'text-night-200'}`}>
                {o.label}
                {won && <Icon name="check" className="ml-1.5 inline h-[0.9em] w-[0.9em] text-flood" title="Winner" />}
              </span>
              <span className={`num ${big ? 'text-display' : 'text-[2.1rem]'} leading-none ${TONE_TEXT[tone]}`}>
                <Pct p={roomProb(market, o.id)} arrow />
              </span>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

export function GameBoard({ markets }: { markets: Market[] }) {
  const n = markets.length;
  // 1: full stage. 2: side by side. 3: the headline market tall on the left, two stacked right.
  // 4: a 2x2 grid. Hairlines separate them; no card borders.
  const layout =
    n === 1
      ? 'grid-cols-1 grid-rows-1'
      : n === 2
        ? 'grid-cols-2 grid-rows-1 [&>*:nth-child(2)]:border-l'
        : n === 3
          ? 'grid-cols-2 grid-rows-2 [&>*:first-child]:row-span-2 [&>*:nth-child(n+2)]:border-l [&>*:nth-child(3)]:border-t'
          : 'grid-cols-2 grid-rows-2 [&>*:nth-child(2n)]:border-l [&>*:nth-child(n+3)]:border-t';
  return (
    <section className={`grid h-full min-h-0 overflow-hidden rounded-panel bg-night-900 [&>*]:border-night-700 ${layout}`} aria-label="Game-long markets">
      {markets.map((m, i) => (
        <GameCell key={m.id} market={m} big={n <= 2 || (n === 3 && i === 0)} />
      ))}
    </section>
  );
}

/* ---------------- Rail: leaders + trades ---------------- */

export function LeaderRail({ players, party, max = 5 }: { players: PlayerPublic[]; party: Party; max?: number }) {
  const ranked = leaderboard(players).slice(0, max);
  return (
    <ol className="flex min-w-0 items-center gap-5" aria-label="Leaderboard">
      {ranked.map((pl, i) => (
        <motion.li layout="position" transition={{ type: 'spring', stiffness: 520, damping: 42 }} key={pl.pubkey} className="flex shrink-0 items-baseline gap-2">
          <span className={`num text-lead ${i === 0 ? 'text-flood' : 'text-night-400'}`}>{i + 1}</span>
          <span className="max-w-[7.5rem] truncate text-lead font-semibold">{pl.name}</span>
          {pl.remote && <Icon name="globe" className="h-[0.9em] w-[0.9em] self-center text-night-400" title="Remote" />}
          <span className={`num flex items-center gap-0.5 text-lead ${pl.pnl > 0 ? 'text-yes' : pl.pnl < 0 ? 'text-no' : 'text-night-200'}`}>
            {pl.pnl !== 0 && <Icon name={pl.pnl > 0 ? 'up' : 'down'} className="h-[0.6em] w-[0.6em]" />}
            <Roll text={moneyShort(pl.pnl, party, { sign: true })} value={pl.pnl} />
          </span>
        </motion.li>
      ))}
      {ranked.length === 0 && <li className="text-lead text-night-400">No players yet</li>}
    </ol>
  );
}

export function TradeTicker() {
  const party = useParty();
  const s = party.view.snapshot!;
  const items = tickerItems(s.fills, s.markets, 3);
  return (
    <ul
      className="flex min-w-0 flex-1 items-center gap-5 overflow-hidden border-l border-night-700 pl-5 [mask-image:linear-gradient(90deg,#000_80%,transparent)]"
      aria-label="Recent trades"
    >
      {items.map((t) => (
        <li key={t.id} className="ticker-in flex shrink-0 items-baseline gap-1.5 whitespace-nowrap text-body">
          <span className="font-semibold text-chalk">{t.name}</span>
          <span className="text-night-400">{t.verb}</span>
          <span className={`flex items-center gap-1 font-semibold ${t.dir === 'up' ? 'text-yes' : 'text-no'}`}>
            <Icon name={t.dir} className="h-[0.7em] w-[0.7em] self-center" />
            {t.outcomeLabel}
          </span>
          <span className="num text-lead text-chalk">{moneyShort(t.amount, s.party)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Captions ---------------- */

export function CaptionBar({ lines }: { lines: AnnouncerLine[] }) {
  const speaking = useBox((s) => s.speaking);
  const line = speaking ?? lines[lines.length - 1] ?? null;
  const live = !!speaking && speaking.id === line?.id;
  return (
    <div className="flex h-[3.5rem] items-center gap-3 border-t border-night-700 px-4" aria-live="polite" aria-label="Announcer captions">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${live ? 'bg-flood text-flood-ink' : 'bg-night-800 text-night-400'}`}
        aria-hidden="true"
      >
        <Icon name="speaker" className="h-5 w-5" />
      </span>
      {line ? (
        <p key={line.id} className={`hd-fade line-clamp-2 min-w-0 text-lead font-semibold leading-snug ${live ? 'text-chalk' : 'text-night-200'}`}>
          {line.text}
        </p>
      ) : (
        <p className="text-lead text-night-400">The announcer calls every market here.</p>
      )}
    </div>
  );
}

/* ---------------- Result reveal ---------------- */

export function ResultReveal({ market, summary, party, onDone }: { market: Market; summary: ResultSummary; party: Party; onDone: () => void }) {
  const voided = market.state === 'voided';
  const n = market.outcomes.length;
  const winIdx = Math.max(0, market.outcomes.findIndex((o) => o.id === market.outcome));
  const tone: Tone = toneFor(winIdx, n);
  const at = market.roomProbAtLock ?? market.price;
  const shares = market.outcomes.map((o) => at?.[o.id] ?? roomProb(market, o.id));
  const sum = shares.reduce((a, b) => a + b, 0) || 1;
  const winShare = (shares[winIdx] ?? 0) / sum;
  const origin = winIdx === 0 ? 'left' : winIdx === n - 1 ? 'right' : 'center';
  return (
    <section
      className="hd-fade absolute inset-0 z-reveal flex flex-col overflow-hidden rounded-panel bg-night-950 px-8 pb-5 pt-6 ring-1 ring-inset ring-night-700"
      role="status"
      aria-label={voided ? 'Market voided' : 'Result'}
    >
      <p className="text-body text-night-400">{voided ? 'Voided' : 'Result'}</p>
      <p className="q line-clamp-2 text-title text-night-200">{market.question}</p>
      {/* The split resolves: winner floods out from its seam, the rest drains. */}
      <div className="relative mt-4 h-4 overflow-hidden rounded-chip bg-night-800" aria-hidden="true">
        {voided ? (
          <div className="hd-drain absolute inset-0 hd-tone-other" />
        ) : (
          <>
            <SplitBar className="hd-drain absolute inset-0" parts={marketSplit(market)} />
            <div
              className={`hd-flood absolute inset-0 ${TONE_SWATCH[tone]}`}
              style={{ ['--from' as string]: String(winShare), ['--origin' as string]: origin } as CSSProperties}
            />
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-1 items-center gap-8 pt-2">
        <div className={`hd-stamp num flex min-w-0 items-center gap-4 text-giant ${voided ? 'text-chalk' : TONE_TEXT[tone]}`} style={delay(250)}>
          {voided ? (
            <span className="text-hero">Stakes refunded</span>
          ) : (
            <>
              <Icon name="check" className="h-[0.7em] w-[0.7em] shrink-0" strokeWidth={3} />
              <span className="line-clamp-1 min-w-0 break-words">{summary.winnerLabel ?? market.outcome}</span>
            </>
          )}
        </div>
      </div>
      {!voided && (summary.winners.length > 0 || summary.losers.length > 0) && (
        <div className="hd-rise grid grid-cols-2 gap-8" style={delay(600)}>
          <div>
            <p className="mb-1 flex items-center gap-2 text-lead font-bold text-yes">
              <Icon name="up" className="h-[0.7em] w-[0.7em]" /> Called it
            </p>
            {summary.winners.slice(0, 3).map((w, i) => (
              <p key={w.name} className="hd-shine flex items-baseline justify-between gap-3 text-title font-bold" style={delay(800 + i * 180)}>
                <span className="truncate">{w.name}</span>
                <span className="num text-title text-night-200">{moneyShort(w.amount, party)} in</span>
              </p>
            ))}
            {summary.winners.length === 0 && <p className="text-lead text-night-400">Nobody. Brutal.</p>}
          </div>
          <div>
            <p className="mb-1 flex items-center gap-2 text-lead font-bold text-no">
              <Icon name="down" className="h-[0.7em] w-[0.7em]" /> Cooked
            </p>
            {summary.losers.slice(0, 3).map((w) => (
              <p key={w.name} className="flex items-baseline justify-between gap-3 text-title font-bold text-night-200">
                <span className="truncate">{w.name}</span>
                <span className="num text-title text-night-400">{moneyShort(w.amount, party)} lost</span>
              </p>
            ))}
            {summary.losers.length === 0 && <p className="text-lead text-night-400">Clean sweep.</p>}
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-4">
        <p className="text-body text-night-400">{voided ? 'Every stake went back to its owner.' : 'Wrong call? Flag it from your phone in the next 20 seconds.'}</p>
        <button type="button" className="btn-secondary min-h-[2.75rem] text-body" onClick={onDone}>
          Back to the board
        </button>
      </div>
    </section>
  );
}

/* ---------------- Dispute banner ---------------- */

export function DisputeBanner({ markets, players, onOpen }: { markets: Market[]; players: PlayerPublic[]; onOpen: () => void }) {
  const m = markets[0];
  if (!m) return null;
  const who = players.find((p) => p.pubkey === m.dispute?.by)?.name ?? 'A player';
  const label = m.outcomes.find((o) => o.id === m.outcome)?.label ?? m.outcome;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="hd-drop flex w-full items-center gap-3 rounded-tile bg-no-deep px-4 py-2.5 text-left ring-1 ring-inset ring-no-dim transition-colors duration-quick hover:bg-[#3a1d09]"
      role="alert"
    >
      <Icon name="flag" className="h-6 w-6 shrink-0 text-no" />
      <span className="shrink-0 text-lead font-bold text-chalk">Result disputed</span>
      <span className="min-w-0 flex-1 truncate text-body text-night-200">
        {who} flagged “{m.question}” → {label}
        {m.dispute?.reason ? `: ${m.dispute.reason}` : ''}
      </span>
      <span className="shrink-0 rounded-chip bg-no px-3 py-1.5 text-body font-bold text-no-ink">
        Host decides{markets.length > 1 ? ` (${markets.length})` : ''}
      </span>
    </button>
  );
}
