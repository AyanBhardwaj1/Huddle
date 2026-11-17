import type { AnnouncerLine, GameState, Market, Party, PlayerPublic } from '@huddle/shared';
import {
  Avatar,
  Burst,
  Icon,
  Kinetic,
  LockRing,
  MarkerShape,
  Pct,
  pctText,
  Roll,
  Sparkline,
  SplitBar,
  SplitMarkers,
  toneFor,
  useReplayClass,
  useSeries,
  type Tone,
} from '@huddle/ui';
import { motion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';
import {
  countdown,
  leaderboard,
  MODE_LABEL,
  moneyShort,
  payoutLine,
  priceHistory,
  prosRow,
  roomProb,
  tickerItems,
  type ResultSummary,
} from '../lib/derive';
import { useNow, useParty } from '../party';
import { useBox } from '../store';

/** Text-safe outcome colours on light surfaces. */
export const TONE_TEXT: Record<Tone, string> = { yes: 'text-yes-600', no: 'text-no-600', other: 'text-sun-600', 'other-alt': 'text-lilac-600' };
/** Solid outcome fills with their text colour (white on YES blue, ink on the others). */
export const TONE_FILL: Record<Tone, string> = {
  yes: 'bg-yes text-yes-on shadow-yes',
  no: 'bg-no text-no-on shadow-no',
  other: 'bg-sun text-sun-on',
  'other-alt': 'bg-lilac text-lilac-on',
};
export const TONE_SWATCH: Record<Tone, string> = { yes: 'hd-tone-yes', no: 'hd-tone-no', other: 'hd-tone-other', 'other-alt': 'hd-tone-other-alt' };
const TONE_LINE: Record<Tone, { stroke: string; fill: string }> = {
  yes: { stroke: '#1468FF', fill: 'rgba(20,104,255,0.14)' },
  no: { stroke: '#FF6B00', fill: 'rgba(255,107,0,0.14)' },
  other: { stroke: '#8A5F00', fill: 'rgba(255,200,61,0.2)' },
  'other-alt': { stroke: '#5B46C7', fill: 'rgba(185,168,255,0.24)' },
};
export const delay = (ms: number) => ({ ['--d' as string]: `${ms}ms` }) as CSSProperties;
const LAYOUT_SPRING = { type: 'spring', stiffness: 520, damping: 40 } as const;

/* ---------------- Top bar: scorebug + join + controls ---------------- */

function TeamScore({ name, short, color, score, side }: { name: string; short: string; color?: string; score: number; side: 'home' | 'away' }) {
  const stamp = useReplayClass(score, 'hd-beat');
  return (
    <div className={`flex items-center gap-2.5 ${side === 'away' ? 'flex-row-reverse' : ''}`}>
      <span className="h-7 w-2 shrink-0 rounded-full" style={{ background: color ?? '#8A86AA' }} aria-hidden="true" />
      <span className="font-head text-title font-extrabold leading-none" title={name}>
        {short}
      </span>
      <span className={`num inline-block min-w-[1.4ch] rounded-chip bg-ink px-1.5 py-0.5 text-center text-[2rem] leading-none text-white ${stamp}`}>
        <Roll text={String(score)} flash={false} duration={700} />
      </span>
    </div>
  );
}

export function Scorebug({ game, party }: { game: GameState; party: Party }) {
  const live = game.status === 'live';
  return (
    <div
      className="hd-drop flex items-center gap-4 rounded-full bg-card py-1.5 pl-3 pr-3 shadow-lift"
      aria-label={`${game.home.name} ${game.score.home}, ${game.away.name} ${game.score.away}, ${game.clock.display}`}
    >
      <TeamScore name={game.home.name} short={game.home.short} color={game.home.color} score={game.score.home} side="home" />
      <div className="flex min-w-[4.25rem] flex-col items-center leading-none">
        <span className="num text-title">{game.clock.display}</span>
        <span className="mt-1 flex items-center gap-1.5 text-small font-semibold text-ink-2">
          {live ? (
            <>
              <span className="live-dot h-2 w-2 rounded-full bg-hot" aria-hidden="true" />
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
    <header className="relative z-10 flex h-[4rem] items-center gap-4 px-4 pt-1">
      <div className="flex shrink-0 items-center">{left}</div>
      <div className="flex min-w-0 flex-1 items-center justify-center">{middle}</div>
      <div className="flex shrink-0 items-center gap-2">{right}</div>
    </header>
  );
}

/* ---------------- Outcomes ---------------- */

/** One outcome as a solid game tile: label, the rolling price, and what a unit pays. */
function OutcomeTile({ market, index, size, party, d }: { market: Market; index: number; size: 'hero' | 'big' | 'display'; party: Party | undefined; d: number }) {
  const o = market.outcomes[index]!;
  const tone = toneFor(index, market.outcomes.length);
  const prob = roomProb(market, o.id);
  const pool = market.pool?.[o.id];
  const kick = useReplayClass(Math.round(prob * 100), 'tile-kick');
  const locked = market.state !== 'open';
  return (
    <div className="hd-pop min-w-0" style={delay(d)}>
      <div className={`on-fill relative flex h-full min-w-0 flex-col overflow-hidden rounded-panel px-4 pb-3 pt-3 ${TONE_FILL[tone]} ${kick}`}>
        {(tone === 'other' || tone === 'other-alt') && <span className={`absolute inset-y-0 right-0 w-3 ${TONE_SWATCH[tone]}`} aria-hidden="true" />}
        <span className={`flex min-w-0 items-center gap-2 font-head font-extrabold leading-tight ${market.outcomes.length > 2 ? 'text-lead' : 'text-title'}`}>
          <span className="line-clamp-2 min-w-0 break-words">{o.label}</span>
        </span>
        <span className={`num mt-auto leading-[0.88] ${size === 'hero' ? 'text-hero' : size === 'big' ? 'text-[4.25rem]' : 'text-display'}`}>
          <Pct p={prob} arrow />
        </span>
        <span className="mt-1 truncate text-body font-semibold opacity-90">
          {market.mode === 'pool' && pool !== undefined ? `${moneyShort(pool, party)} in the pool` : payoutLine(prob, party)}
        </span>
        {locked && <span className="lock-veil" aria-hidden="true" />}
      </div>
    </div>
  );
}

/** Room vs Model vs Gemini on the same outcome, as a row of numbers. */
function ProsLegend({ market }: { market: Market }) {
  const row = prosRow(market);
  if (!row) return null;
  return (
    <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-body text-ink-2">
      <div className="flex items-baseline gap-1.5">
        <dt>Room on {row.outcomeLabel}</dt>
        <dd className="num text-title text-zap">{pctText(row.room)}%</dd>
      </div>
      <div className="flex items-baseline gap-1.5">
        <dt className="flex items-center gap-1.5">
          <MarkerShape shape="solid" className="self-center text-ink" /> Model
        </dt>
        <dd className="num text-title text-ink">{pctText(row.model)}%</dd>
      </div>
      {row.gemini !== undefined && (
        <div className="flex items-baseline gap-1.5">
          <dt className="flex items-center gap-1.5">
            <MarkerShape shape="hollow" className="self-center text-ink" /> Gemini
          </dt>
          <dd className="num text-title text-ink">{pctText(row.gemini)}%</dd>
        </div>
      )}
    </dl>
  );
}

export function marketSplit(market: Market) {
  return market.outcomes.map((o) => ({ id: o.id, label: o.label, p: roomProb(market, o.id) }));
}

/** Notch positions on the split are cumulative: the pros' number for the first outcome. */
function prosMarkers(market: Market) {
  const row = prosRow(market);
  if (!row) return [];
  const idx = market.outcomes.findIndex((o) => o.label === row.outcomeLabel);
  if (idx !== 0) return [];
  const m: { id: string; label: string; p: number; shape: 'solid' | 'hollow' }[] = [{ id: 'model', label: 'Model', p: row.model, shape: 'solid' }];
  if (row.gemini !== undefined) m.push({ id: 'gemini', label: 'Gemini', p: row.gemini, shape: 'hollow' });
  return m;
}

/** The first outcome's price since the market opened, drawn on as trades land. */
export function PriceChart({ market, className = '', compact = false }: { market: Market; className?: string; compact?: boolean }) {
  const { view } = useParty();
  const fills = view.snapshot?.fills ?? [];
  const first = market.outcomes[0];
  const now = first ? roomProb(market, first.id) : null;
  const pts = useSeries(market.id, now, first ? priceHistory(market, fills) : []);
  if (!first) return null;
  const start = pts[0]?.p ?? now ?? 0;
  const diff = Math.round(((now ?? start) - start) * 100);
  const tone = toneFor(0, market.outcomes.length);
  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      <p className="flex items-baseline justify-between gap-2 text-small font-semibold text-ink-2">
        <span className="truncate">{first.label} price</span>
        <span className={`num flex shrink-0 items-center gap-0.5 text-lead ${diff > 0 ? 'text-yes-600' : diff < 0 ? 'text-no-600' : 'text-ink-muted'}`}>
          {diff !== 0 && <Icon name={diff > 0 ? 'up' : 'down'} className="h-[0.55em] w-[0.55em]" />}
          {diff === 0 ? 'Flat' : `${diff > 0 ? '+' : ''}${diff} pts`}
        </span>
      </p>
      <Sparkline points={pts} className={`mt-1 w-full ${compact ? 'h-[2.25rem]' : 'h-[3.25rem]'}`} stroke={TONE_LINE[tone].stroke} fill={TONE_LINE[tone].fill} />
      {!compact && (
        <p className="mt-1 flex justify-between text-small text-ink-muted">
          <span>Open {pctText(start)}%</span>
          <span>{pts.length > 1 ? `${pts.length - 1} ${pts.length === 2 ? 'move' : 'moves'}` : 'No trades yet'}</span>
        </p>
      )}
    </div>
  );
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
  const size = compact || tight ? 'display' : 'big';
  return (
    <section
      className={`hd-zoom relative flex h-full min-h-0 flex-col overflow-hidden rounded-blob bg-card px-6 pb-4 pt-4 shadow-pop ${locked ? 'is-locked' : ''}`}
      aria-label="Moment market"
    >
      {/* A ribbon of the brand gradient across the top edge. */}
      <span className="absolute inset-x-0 top-0 h-1.5 bg-prime" aria-hidden="true" />
      <div className="hd-wipe" aria-hidden="true" />
      {lockState === 'urgent' && <span className="urgent-edge" aria-hidden="true" />}
      {flash && locked && <div key={flash} className="hd-flashout absolute inset-0 z-10 bg-zap-100" aria-hidden="true" />}
      <div className="flex min-h-0 flex-1 gap-6">
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-ink-2 [&>span]:whitespace-nowrap">
            {locked ? (
              <span key="locked" className="hd-pop flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 font-bold text-white">
                <Icon name="lock" className="h-[1em] w-[1em]" /> Locked, waiting for the result
              </span>
            ) : (
              <span key="open" className="hd-pop flex items-center gap-2 rounded-full bg-prime px-3 py-1 font-bold text-white shadow-zap">
                <Icon name="bolt" className="h-[1em] w-[1em]" strokeWidth={2.4} />
                Moment market
              </span>
            )}
            <span className="hd-fade" style={delay(200)}>
              {MODE_LABEL[market.mode]} mode
            </span>
            {!compact && (
              <span className="hd-fade tnum" style={delay(260)}>
                · <Roll text={moneyShort(market.volume, p)} value={market.volume} flash={false} /> traded
              </span>
            )}
          </p>
          <h1 className={`q mt-2 line-clamp-3 shrink-0 leading-[1.02] ${compact || tight ? 'text-[2.05rem]' : 'text-[2.45rem]'}`}>
            <Kinetic text={market.question} delay={140} stagger={45} />
          </h1>
          <div className="mt-auto flex flex-col gap-2 pt-2.5">
            {binary ? (
              <div className="grid grid-cols-2 gap-3">
                <OutcomeTile market={market} index={0} size={size} party={p} d={380} />
                <OutcomeTile market={market} index={1} size={size} party={p} d={460} />
              </div>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(n, 4)}, minmax(0, 1fr))` }}>
                {market.outcomes.slice(0, 4).map((o, i) => (
                  <OutcomeTile key={o.id} market={market} index={i} size="display" party={p} d={380 + i * 80} />
                ))}
              </div>
            )}
            <div className="hd-fade" style={delay(560)}>
              <SplitMarkers className="text-lead text-ink" markers={prosMarkers(market)} />
              <SplitBar className="h-4 rounded-full" parts={marketSplit(market)} />
            </div>
            <div className={`hd-fade ${compact ? 'hidden' : ''}`} style={delay(640)}>
              <ProsLegend market={market} />
            </div>
          </div>
        </div>
        <div className="flex w-[11.5rem] shrink-0 flex-col items-center justify-center gap-4">
          <div className="hd-pop" style={delay(240)}>
            <LockRing
              fraction={cd ? cd.fraction : null}
              label={cd ? cd.label : null}
              state={lockState}
              size={compact ? '9rem' : '10.5rem'}
              caption={
                lockState === 'manual' ? (
                  'Locks on the play'
                ) : lockState === 'urgent' ? (
                  <span className="font-bold text-hot-600">Last call</span>
                ) : (
                  <span className="font-semibold text-ink-2">to lock</span>
                )
              }
            />
          </div>
          {!compact && <PriceChart market={market} className="hd-rise w-full" />}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Game-long markets ---------------- */

function GameCell({ market, big, index }: { market: Market; big: boolean; index: number }) {
  const party = useParty();
  const p = party.view.snapshot?.party;
  const settled = market.state === 'resolved' || market.state === 'final';
  const n = market.outcomes.length;
  return (
    <article className={`hd-rise card flex min-h-0 min-w-0 flex-col overflow-hidden px-5 ${big ? 'gap-2 py-4' : 'gap-1.5 py-3'}`} style={delay(index * 90)} aria-label={market.question}>
      <p className="flex items-center gap-2 text-small font-semibold text-ink-2">
        {market.state === 'open' && (
          <span className="flex items-center gap-1.5 text-zap">
            <span className="live-dot h-2 w-2 rounded-full bg-zap" aria-hidden="true" />
            {MODE_LABEL[market.mode]} · all game
          </span>
        )}
        {market.state === 'locked' && (
          <span className="flex items-center gap-1.5 text-ink">
            <Icon name="lock" className="h-[1em] w-[1em]" /> Locked
          </span>
        )}
        {market.state === 'disputed' && (
          <span className="flex items-center gap-1.5 text-hot-600">
            <Icon name="flag" className="h-[1em] w-[1em]" /> Result disputed
          </span>
        )}
        {settled && (
          <span className="flex items-center gap-1.5 text-ink">
            <Icon name="check" className="h-[1em] w-[1em]" /> Settled
          </span>
        )}
        <span className="tnum ml-auto font-normal text-ink-muted">{moneyShort(market.volume, p)} traded</span>
      </p>
      <h2 className={`q line-clamp-2 shrink-0 leading-[1.05] ${big ? 'text-head' : 'text-title'}`}>
        <Kinetic text={market.question} delay={index * 90 + 80} stagger={35} />
      </h2>
      <SplitBar className={`mt-1 shrink-0 rounded-full ${big ? 'h-3.5' : 'h-2.5'}`} parts={marketSplit(market)} />
      <ul className={`flex min-h-0 flex-col overflow-hidden ${big ? 'my-auto gap-1' : 'mt-0.5 gap-0'}`}>
        {market.outcomes.slice(0, 4).map((o, i) => {
          const tone = toneFor(i, n);
          const won = settled && market.outcome === o.id;
          return (
            <li key={o.id} className="flex items-baseline gap-2.5">
              <span className={`h-3 w-3 shrink-0 self-center rounded-[4px] ${TONE_SWATCH[tone]}`} aria-hidden="true" />
              <span className={`min-w-0 flex-1 truncate text-lead ${won ? 'font-bold text-ink' : 'text-ink-2'}`}>
                {o.label}
                {won && <Icon name="check" className="ml-1.5 inline h-[0.9em] w-[0.9em] text-zap" title="Winner" />}
              </span>
              <span className={`num ${big ? 'text-display' : 'text-[1.75rem]'} leading-none ${TONE_TEXT[tone]}`}>
                <Pct p={roomProb(market, o.id)} arrow />
              </span>
            </li>
          );
        })}
      </ul>
      {big && market.state === 'open' && <PriceChart market={market} compact className="mt-auto" />}
    </article>
  );
}

export function GameBoard({ markets }: { markets: Market[] }) {
  const n = markets.length;
  // 1: full stage. 2: side by side. 3: the headline market tall on the left, two stacked right.
  // 4: a 2x2 grid.
  const layout =
    n === 1 ? 'grid-cols-1 grid-rows-1' : n === 2 ? 'grid-cols-2 grid-rows-1' : n === 3 ? 'grid-cols-2 grid-rows-2 [&>*:first-child]:row-span-2' : 'grid-cols-2 grid-rows-2';
  return (
    <section className={`grid h-full min-h-0 gap-3 overflow-hidden ${layout}`} aria-label="Game-long markets">
      {markets.map((m, i) => (
        <GameCell key={m.id} market={m} index={i} big={n <= 2 || (n === 3 && i === 0)} />
      ))}
    </section>
  );
}

/* ---------------- Rail: leaders + trades ---------------- */

export function LeaderRail({ players, party, max = 5 }: { players: PlayerPublic[]; party: Party; max?: number }) {
  const ranked = leaderboard(players).slice(0, max);
  return (
    <ol className="flex min-w-0 items-center gap-2" aria-label="Leaderboard">
      {ranked.map((pl, i) => (
        <motion.li
          layout="position"
          transition={LAYOUT_SPRING}
          key={pl.pubkey}
          className={`flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-3 ${i === 0 ? 'bg-ink text-white shadow-pop' : 'bg-card shadow-lift'}`}
        >
          <span className="relative">
            <Avatar name={pl.name} size="1.85rem" />
            <span
              className={`num absolute -bottom-1 -right-1 flex h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded-full px-0.5 text-[0.75rem] leading-none ${i === 0 ? 'bg-gold text-gold-on' : 'bg-ink text-white'}`}
            >
              {i + 1}
            </span>
          </span>
          <span className="max-w-[6.5rem] truncate text-lead font-bold">{pl.name}</span>
          {pl.remote && <Icon name="globe" className="h-[0.9em] w-[0.9em] text-ink-muted" title="Remote" />}
          <span
            className={`num flex items-center gap-0.5 text-lead ${
              i === 0 ? '' : pl.pnl > 0 ? 'text-yes-600' : pl.pnl < 0 ? 'text-no-600' : 'text-ink-2'
            } ${i === 0 ? 'on-fill' : ''}`}
          >
            {pl.pnl !== 0 && <Icon name={pl.pnl > 0 ? 'up' : 'down'} className="h-[0.6em] w-[0.6em]" />}
            <Roll text={moneyShort(pl.pnl, party, { sign: true })} value={pl.pnl} />
          </span>
        </motion.li>
      ))}
      {ranked.length === 0 && <li className="text-lead text-ink-muted">No players yet</li>}
    </ol>
  );
}

export function TradeTicker() {
  const party = useParty();
  const s = party.view.snapshot!;
  const items = tickerItems(s.fills, s.markets, 3);
  return (
    <ul
      className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden [mask-image:linear-gradient(90deg,#000_82%,transparent)]"
      aria-label="Recent trades"
    >
      {items.map((t) => (
        <li key={t.id} className="hd-slide-r flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-card py-1 pl-1 pr-3 text-body shadow-lift">
          <Avatar name={t.name} size="1.6rem" />
          <span className="font-bold text-ink">{t.name}</span>
          <span className="text-ink-2">{t.verb}</span>
          <span className={`flex items-center gap-1 font-bold ${t.dir === 'up' ? 'text-yes-600' : 'text-no-600'}`}>
            <Icon name={t.dir} className="h-[0.7em] w-[0.7em]" />
            {t.outcomeLabel}
          </span>
          <span className="num text-lead text-ink">{moneyShort(t.amount, s.party)}</span>
          {typeof t.price === 'number' && <span className="num text-body text-ink-muted">@ {pctText(t.price)}%</span>}
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
    <div className="relative z-10 px-3 pb-2.5" aria-live="polite" aria-label="Announcer captions">
      <div className="flex h-[3.25rem] items-center gap-3 rounded-full bg-ink pl-1.5 pr-5 text-white shadow-pop">
        <span
          className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${live ? 'bg-prime text-white' : 'bg-white/10 text-white/80'}`}
          aria-hidden="true"
        >
          {live && <span className="absolute inset-0 rounded-full bg-zap hd-ping" />}
          <Icon name="speaker" className="relative h-5 w-5" />
        </span>
        {line ? (
          <p className="line-clamp-2 min-w-0 text-lead font-semibold leading-[1.18]">
            <Kinetic text={line.text} replay={line.id} stagger={28} />
          </p>
        ) : (
          <p className="text-lead text-white/70">The announcer calls every market here.</p>
        )}
      </div>
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
  const pot = summary.winners.reduce((a, w) => a + w.amount, 0) + summary.losers.reduce((a, w) => a + w.amount, 0);
  // The celebration is sized to the moment: more callers and more money, more confetti.
  const bits = voided ? 0 : Math.min(48, 14 + summary.winners.length * 6 + Math.round(pot / 2_000_000));
  const onWin = tone === 'yes' ? 'text-white' : 'text-ink';
  return (
    <section
      className="hd-zoom absolute inset-0 z-reveal flex flex-col overflow-hidden rounded-blob bg-card shadow-pop"
      role="status"
      aria-label={voided ? 'Market voided' : 'Result'}
    >
      {/* The winner floods the stage from its own share of the split; the rest drains away. */}
      {voided ? (
        <div className="hd-fade absolute inset-0 bg-well" aria-hidden="true" />
      ) : (
        <div
          className={`hd-flood absolute inset-0 ${TONE_SWATCH[tone]}`}
          style={{ ['--from' as string]: String(winShare), ['--origin' as string]: origin, ['--d' as string]: '150ms' } as CSSProperties}
          aria-hidden="true"
        />
      )}
      {bits > 0 && <Burst seed={market.id.length + winIdx + 3} count={bits} x="32%" y="42%" spread={18} delay={520} />}
      <div className={`relative z-10 flex min-h-0 flex-1 flex-col px-8 pb-5 pt-6 ${voided ? 'text-ink' : onWin}`}>
        <p className="hd-fade text-body font-semibold opacity-90">{voided ? 'Voided' : 'Result'}</p>
        <p className="q hd-fade line-clamp-2 text-title opacity-90">{market.question}</p>
        <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-white/30" aria-hidden="true">
          <SplitBar className="hd-drain absolute inset-0" parts={marketSplit(market)} />
        </div>
        <div className="flex min-h-0 flex-1 items-center gap-8 pt-2">
          <div className="hd-stamp flex min-w-0 items-center gap-4 font-head text-giant font-extrabold leading-[0.85] tracking-[-0.05em]" style={delay(380)}>
            {voided ? (
              <span className="text-hero">Stakes refunded</span>
            ) : (
              <>
                <Icon name="check" className="h-[0.7em] w-[0.7em] shrink-0" strokeWidth={3.2} />
                <span className="line-clamp-1 min-w-0 break-words">{summary.winnerLabel ?? market.outcome}</span>
              </>
            )}
          </div>
        </div>
        {!voided && (summary.winners.length > 0 || summary.losers.length > 0) && (
          <div className="hd-rise grid grid-cols-2 gap-4" style={delay(760)}>
            <div className="rounded-panel bg-card px-4 py-3 text-ink shadow-pop">
              <p className="mb-1 flex items-center gap-2 text-lead font-bold text-yes-600">
                <Icon name="up" className="h-[0.7em] w-[0.7em]" /> Called it
              </p>
              {summary.winners.slice(0, 3).map((w, i) => (
                <p key={w.name} className="hd-shine flex items-center gap-2.5 py-0.5 text-title font-bold" style={delay(1000 + i * 180)}>
                  <Avatar name={w.name} size="1.9rem" />
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  <span className="num text-title text-ink-2">{moneyShort(w.amount, party)} in</span>
                </p>
              ))}
              {summary.winners.length === 0 && <p className="text-lead text-ink-2">Nobody. Brutal.</p>}
            </div>
            <div className="rounded-panel bg-card/85 px-4 py-3 text-ink shadow-lift">
              <p className="mb-1 flex items-center gap-2 text-lead font-bold text-no-600">
                <Icon name="down" className="h-[0.7em] w-[0.7em]" /> Cooked
              </p>
              {summary.losers.slice(0, 3).map((w) => (
                <p key={w.name} className="flex items-center gap-2.5 py-0.5 text-title font-bold text-ink-2">
                  <span className="opacity-60">
                    <Avatar name={w.name} size="1.9rem" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  <span className="num text-title text-ink-muted">{moneyShort(w.amount, party)} lost</span>
                </p>
              ))}
              {summary.losers.length === 0 && <p className="text-lead text-ink-2">Clean sweep.</p>}
            </div>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="text-body font-semibold opacity-90">{voided ? 'Every stake went back to its owner.' : 'Wrong call? Flag it from your phone in the next 20 seconds.'}</p>
          <button type="button" className="btn-secondary min-h-[2.75rem] text-body" onClick={onDone}>
            Back to the board
          </button>
        </div>
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
      className="hd-drop hd-press flex w-full items-center gap-3 rounded-full bg-card py-1.5 pl-1.5 pr-1.5 text-left shadow-lift ring-2 ring-inset ring-hot hover:bg-hot-50"
      role="alert"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hot text-hot-on">
        <Icon name="flag" className="h-5 w-5" />
      </span>
      <span className="shrink-0 text-lead font-bold text-ink">Result disputed</span>
      <span className="min-w-0 flex-1 truncate text-body text-ink-2">
        {who} flagged “{m.question}” → {label}
        {m.dispute?.reason ? `: ${m.dispute.reason}` : ''}
      </span>
      <span className="shrink-0 rounded-full bg-ink px-4 py-2 text-body font-bold text-white">
        Host decides{markets.length > 1 ? ` (${markets.length})` : ''}
      </span>
    </button>
  );
}
