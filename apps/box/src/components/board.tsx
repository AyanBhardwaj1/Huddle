import type { AnnouncerLine, GameState, Market, Party, PlayerPublic } from '@huddle/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import {
  countdown,
  leaderboard,
  MODE_LABEL,
  moneyShort,
  outcomeTone,
  payoutLine,
  prosRow,
  roomProb,
  tickerItems,
  type ResultSummary,
} from '../lib/derive';
import { useNow, useParty } from '../party';
import { useBox } from '../store';
import { AnimatedPct, Icon } from './ui';

const TONE_TEXT = { up: 'text-up', down: 'text-down', neutral: 'text-pitch-50' } as const;
const TONE_BAR = { up: 'bg-up', down: 'bg-down', neutral: 'bg-pitch-200' } as const;
const TONE_ICON = { up: 'up', down: 'down', neutral: null } as const;

/* ---------------- Scorebug ---------------- */

function TeamBlock({
  name,
  short,
  color,
  score,
  side,
}: {
  name: string;
  short: string;
  color?: string;
  score: number;
  side: 'home' | 'away';
}) {
  const bar = <span className="h-full w-[0.45rem] shrink-0" style={{ background: color ?? '#7C8AA0' }} />;
  // Flash the score only when it changes, not on first paint.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  return (
    <div className={`flex h-full items-stretch ${side === 'away' ? 'flex-row-reverse' : ''}`}>
      {bar}
      <div className={`flex items-center gap-3 bg-pitch-800 px-4 ${side === 'away' ? 'flex-row-reverse' : ''}`}>
        <span className="font-display text-[2rem] font-bold uppercase leading-none tracking-wide" title={name}>
          {short}
        </span>
      </div>
      <motion.span
        key={score}
        initial={mounted.current ? { scale: 1.6, backgroundColor: '#D4FF3A', color: '#141A05' } : false}
        animate={{ scale: 1, backgroundColor: '#F4F7FB', color: '#07090D' }}
        transition={{ duration: 0.7 }}
        className="tabular flex min-w-[3.4rem] items-center justify-center font-display text-[2.5rem] font-bold leading-none"
      >
        {score}
      </motion.span>
    </div>
  );
}

export function Scorebug({ game, party, right }: { game: GameState; party: Party; right?: React.ReactNode }) {
  const live = game.status === 'live';
  return (
    <header className="flex h-[4rem] shrink-0 items-stretch gap-3 px-3 pt-2">
      <div className="flex items-stretch overflow-hidden rounded-lg shadow-card ring-1 ring-pitch-700">
        <TeamBlock name={game.home.name} short={game.home.short} color={game.home.color} score={game.score.home} side="home" />
        <div className="flex min-w-[5.6rem] flex-col items-center justify-center bg-pitch-950 px-3">
          <span className="tabular font-display text-[1.75rem] font-semibold leading-none">{game.clock.display}</span>
          <span className="mt-0.5 flex items-center gap-1 text-[0.62rem] font-bold uppercase tracking-[0.2em] text-pitch-400">
            {live ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inset-0 animate-ping rounded-full bg-live opacity-70" />
                  <span className="relative h-2 w-2 rounded-full bg-live" />
                </span>
                {party.game.status === 'replay' ? 'Replay' : 'Live'}
              </>
            ) : game.status === 'final' ? (
              'Final'
            ) : (
              'Pre-game'
            )}
          </span>
        </div>
        <TeamBlock name={game.away.name} short={game.away.short} color={game.away.color} score={game.score.away} side="away" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3">{right}</div>
    </header>
  );
}

/* ---------------- Countdown ring ---------------- */

export function CountdownRing({ market, size = '13rem' }: { market: Market; size?: string }) {
  const party = useParty();
  const now = useNow(100);
  const cd = countdown(market, now, party.view.snapshot?.party.config.momentLockSecs);
  const locked = market.state !== 'open';
  const r = 44;
  const c = 2 * Math.PI * r;
  const frac = locked ? 0 : (cd?.fraction ?? 1);
  const urgent = !!cd?.urgent && !locked;
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="timer"
      aria-label={locked ? 'Locked' : cd ? `${cd.label} seconds to lock` : 'Open'}
    >
      {urgent && <span className="absolute inset-[6%] animate-pulse-ring rounded-full border-4 border-live" />}
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#1E2633" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={locked ? '#7C8AA0' : urgent ? '#FF4D5E' : '#D4FF3A'}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 0.12s linear, stroke 0.3s' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {locked ? (
          <>
            <Icon name="lock" className="h-[28%] w-[28%] text-pitch-200" />
            <span className="mt-1 font-display text-[1.5rem] font-bold uppercase tracking-widest text-pitch-200">Locked</span>
          </>
        ) : cd ? (
          <>
            <motion.span
              key={cd.label}
              initial={urgent ? { scale: 1.35 } : false}
              animate={{ scale: 1 }}
              className={`tabular font-display font-bold leading-none ${urgent ? 'text-live' : 'text-pitch-50'}`}
              style={{ fontSize: `calc(${size} * 0.42)` }}
            >
              {cd.label}
            </motion.span>
            <span className="kicker mt-0.5 text-[0.85rem]">{urgent ? 'Last call' : 'to lock'}</span>
          </>
        ) : (
          <>
            <span className="font-display text-[2.4rem] font-bold uppercase text-volt">Open</span>
            <span className="kicker text-[0.8rem]">locks on the play</span>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- Outcome price cards ---------------- */

export function OutcomeCards({ market, big = true }: { market: Market; big?: boolean }) {
  const party = useParty();
  const p = party.view.snapshot?.party;
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(market.outcomes.length, 3)}, minmax(0, 1fr))` }}>
      {market.outcomes.map((o, i) => {
        const tone = outcomeTone(i);
        const prob = roomProb(market, o.id);
        const pool = market.pool?.[o.id];
        const icon = TONE_ICON[tone];
        return (
          <div key={o.id} className="relative overflow-hidden rounded-card bg-pitch-900 px-4 py-2 ring-1 ring-pitch-700">
            <motion.div
              className={`absolute inset-y-0 left-0 opacity-[0.14] ${TONE_BAR[tone]}`}
              animate={{ width: `${Math.round(prob * 100)}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 20 }}
            />
            <div className="relative flex items-center gap-2">
              {icon && <Icon name={icon} className={`h-5 w-5 ${TONE_TEXT[tone]}`} />}
              <span
                className={`truncate font-display font-bold uppercase tracking-wide ${TONE_TEXT[tone]} ${big ? 'text-[1.9rem]' : 'text-[1.5rem]'}`}
              >
                {o.label}
              </span>
            </div>
            <div className={`relative font-display font-bold leading-[0.95] ${big ? 'text-[4.8rem]' : 'text-[3.6rem]'}`}>
              <AnimatedPct value={prob} />
            </div>
            <div className="relative text-[0.95rem] font-medium text-pitch-200">
              {market.mode === 'pool' && pool !== undefined ? `${moneyShort(pool, p)} in the pool` : payoutLine(prob, p)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Friends vs. the Pros ---------------- */

export function ProsRowView({ market, compact = false }: { market: Market; compact?: boolean }) {
  const row = prosRow(market);
  if (!row) return null;
  const cell = (label: string, value: number | undefined, color: string) => (
    <div className={`flex items-baseline gap-2 ${compact ? '' : 'rounded-lg bg-pitch-900/70 px-3 py-1 ring-1 ring-pitch-700'}`}>
      <span className={`text-[0.8rem] font-bold uppercase tracking-[0.15em] ${color}`}>{label}</span>
      <span className={`tabular font-display font-bold ${compact ? 'text-[1.2rem]' : 'text-[1.9rem]'} leading-none`}>
        {value === undefined ? '—' : <AnimatedPct value={value} showArrow={false} />}
      </span>
    </div>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!compact && (
        <span className="kicker mr-1 text-[0.85rem]">
          Friends vs. the Pros · <span className="normal-case tracking-normal text-pitch-200">{row.outcomeLabel}</span>
        </span>
      )}
      {cell('Room', row.room, 'text-volt')}
      {cell('Model', row.model, 'text-model')}
      {row.gemini !== undefined && cell('Gemini', row.gemini, 'text-gemini')}
    </div>
  );
}

/* ---------------- Moment market takeover ---------------- */

export function MarketTakeover({ market, compact = false }: { market: Market; compact?: boolean }) {
  const party = useParty();
  const p = party.view.snapshot?.party;
  return (
    <motion.section
      key={market.id}
      initial={{ opacity: 0, scale: 0.94, y: 24 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className="relative flex h-full flex-col gap-3 overflow-hidden rounded-card bg-gradient-to-br from-pitch-800 to-pitch-900 p-5 ring-2 ring-volt/60"
      aria-live="polite"
    >
      <motion.div
        className="pointer-events-none absolute inset-0 bg-volt"
        initial={{ opacity: 0.35 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.9 }}
      />
      <div className="relative flex min-h-0 flex-1 gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="slant-r bg-volt py-1 pl-3 pr-6 font-display text-[1.1rem] font-bold uppercase tracking-[0.18em] text-volt-ink">
              {market.state === 'open' ? 'Moment market' : 'Locked'}
            </span>
            <span className="kicker">{MODE_LABEL[market.mode]}</span>
            <span className="kicker ml-auto tabular">Volume {moneyShort(market.volume, p)}</span>
          </div>
          <h1 className={`line-clamp-2 font-display font-bold leading-[1.0] tracking-tight ${compact ? 'text-[2.6rem]' : 'text-[3.2rem]'}`}>
            {market.question}
          </h1>
          <div className="mt-auto">
            <OutcomeCards market={market} big={!compact} />
          </div>
        </div>
        <div className="flex flex-col items-center justify-center">
          <CountdownRing market={market} size={compact ? '11rem' : '13rem'} />
        </div>
      </div>
      <div className="relative">
        <ProsRowView market={market} />
      </div>
    </motion.section>
  );
}

/* ---------------- Game-long market tile ---------------- */

export function GameTile({ market }: { market: Market }) {
  const party = useParty();
  const p = party.view.snapshot?.party;
  const settled = market.state === 'resolved' || market.state === 'final';
  return (
    <motion.div layout className="card flex min-h-0 flex-col gap-2 overflow-hidden p-3">
      <div className="flex items-center gap-2">
        <span className="kicker text-[0.75rem]">{MODE_LABEL[market.mode]}</span>
        {market.state === 'locked' && (
          <span className="flex items-center gap-1 text-[0.72rem] font-bold uppercase tracking-widest text-pitch-200">
            <Icon name="lock" className="h-3.5 w-3.5" /> Locked
          </span>
        )}
        {market.state === 'disputed' && (
          <span className="flex items-center gap-1 text-[0.72rem] font-bold uppercase tracking-widest text-down">
            <Icon name="flag" className="h-3.5 w-3.5" /> Disputed
          </span>
        )}
        <span className="ml-auto">
          {market.geminiRef ? (
            <ProsRowView market={market} compact />
          ) : (
            <span className="kicker tabular text-[0.75rem]">{moneyShort(market.volume, p)}</span>
          )}
        </span>
      </div>
      <div className="line-clamp-2 font-display text-[1.35rem] font-semibold leading-tight">{market.question}</div>
      <div className="mt-auto flex flex-col gap-1">
        {market.outcomes.slice(0, 3).map((o, i) => {
          const tone = outcomeTone(i);
          const prob = roomProb(market, o.id);
          const won = settled && market.outcome === o.id;
          return (
            <div key={o.id} className="flex items-center gap-2">
              <span className={`w-[38%] truncate text-[1rem] font-semibold ${won ? 'text-volt' : 'text-pitch-200'}`}>
                {won && <Icon name="check" className="mr-1 inline h-4 w-4" />}
                {o.label}
              </span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-pitch-700">
                <motion.div className={`h-full rounded-full ${TONE_BAR[tone]}`} animate={{ width: `${Math.round(prob * 100)}%` }} />
              </div>
              <span className={`w-[3.6rem] text-right font-display text-[1.5rem] font-bold leading-none ${TONE_TEXT[tone]}`}>
                <AnimatedPct value={prob} showArrow={false} />
              </span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ---------------- Ticker + leaderboard strip ---------------- */

export function TradeTicker() {
  const party = useParty();
  const s = party.view.snapshot!;
  const items = tickerItems(s.fills, s.markets, 6);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden" aria-label="Recent trades">
      <span className="kicker shrink-0 text-[0.75rem]">Trades</span>
      <div className="flex min-w-0 flex-1 gap-2 overflow-hidden">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.span
              key={t.id}
              layout
              initial={{ opacity: 0, x: -30, backgroundColor: 'rgba(212,255,58,0.35)' }}
              animate={{ opacity: 1, x: 0, backgroundColor: 'rgba(20,26,36,1)' }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[0.9rem] ring-1 ring-pitch-700"
            >
              <span className="font-semibold">{t.name}</span>
              <span className="text-pitch-400">{t.verb}</span>
              <span className="tabular font-semibold">{moneyShort(t.amount, s.party)}</span>
              <span className={`flex items-center gap-0.5 font-bold uppercase ${t.dir === 'up' ? 'text-up' : 'text-down'}`}>
                <Icon name={t.dir} className="h-3 w-3" />
                {t.outcomeLabel}
              </span>
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function LeaderStrip({ players, party, max = 5 }: { players: PlayerPublic[]; party: Party; max?: number }) {
  const ranked = leaderboard(players).slice(0, max);
  return (
    <div className="flex min-w-0 items-center gap-2" aria-label="Leaderboard">
      <span className="kicker shrink-0 text-[0.75rem]">Top</span>
      {ranked.map((pl, i) => (
        <motion.span
          layout
          key={pl.pubkey}
          className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 ring-1 ${i === 0 ? 'bg-volt/10 ring-volt/60' : 'bg-pitch-900 ring-pitch-700'}`}
        >
          <span className={`font-display text-[1.05rem] font-bold ${i === 0 ? 'text-volt' : 'text-pitch-400'}`}>{i + 1}</span>
          <span className="max-w-[6rem] truncate text-[0.95rem] font-semibold">{pl.name}</span>
          {pl.remote && <Icon name="remote" className="h-3.5 w-3.5 text-pitch-400" aria-label="remote" />}
          <span className={`tabular flex items-center text-[0.95rem] font-bold ${pl.pnl >= 0 ? 'text-up' : 'text-down'}`}>
            {pl.pnl !== 0 && <Icon name={pl.pnl > 0 ? 'up' : 'down'} className="h-3 w-3" />}
            {moneyShort(pl.pnl, party, { sign: true })}
          </span>
        </motion.span>
      ))}
    </div>
  );
}

/* ---------------- Captions ---------------- */

export function CaptionBar({ lines }: { lines: AnnouncerLine[] }) {
  const speaking = useBox((s) => s.speaking);
  const line = speaking ?? lines[lines.length - 1] ?? null;
  return (
    <div
      className="flex h-[3.3rem] shrink-0 items-center gap-3 border-t border-pitch-700 bg-pitch-900 px-4"
      aria-live="polite"
      aria-label="Announcer captions"
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${speaking ? 'bg-volt text-volt-ink' : 'bg-pitch-700 text-pitch-200'}`}
      >
        <Icon name="sound" className="h-5 w-5" />
      </span>
      <AnimatePresence mode="wait">
        {line ? (
          <motion.p
            key={line.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`line-clamp-2 text-[1.2rem] font-semibold leading-tight ${speaking?.id === line.id ? 'text-pitch-50' : 'text-pitch-200'}`}
          >
            {line.text}
          </motion.p>
        ) : (
          <motion.p key="none" className="text-[1.05rem] text-pitch-400">
            The announcer will call every market here.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------- Result reveal ---------------- */

export function ResultReveal({
  market,
  summary,
  party,
  onDone,
}: {
  market: Market;
  summary: ResultSummary;
  party: Party;
  onDone: () => void;
}) {
  const voided = market.state === 'voided';
  const winIdx = market.outcomes.findIndex((o) => o.id === market.outcome);
  const tone = voided ? 'neutral' : outcomeTone(Math.max(0, winIdx));
  return (
    <motion.div
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 overflow-hidden rounded-card bg-pitch-950/95 p-6 text-center ring-2 ring-volt"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      onClick={onDone}
      role="alert"
    >
      {!voided &&
        Array.from({ length: 18 }).map((_, i) => (
          <motion.span
            key={i}
            className={`absolute h-3 w-3 rounded-sm ${i % 3 === 0 ? 'bg-volt' : i % 3 === 1 ? 'bg-up' : 'bg-pitch-50'}`}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
            animate={{ x: Math.cos((i / 18) * Math.PI * 2) * 520, y: Math.sin((i / 18) * Math.PI * 2) * 300, opacity: 0, rotate: 360 }}
            transition={{ duration: 1.6, ease: 'easeOut' }}
          />
        ))}
      <span className="kicker">{voided ? 'Voided' : 'Result'}</span>
      <p className="max-w-[48rem] font-display text-[1.8rem] font-semibold leading-tight text-pitch-200">{market.question}</p>
      <motion.div
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.15 }}
        className={`flex items-center gap-4 font-display text-[6.5rem] font-bold uppercase leading-none ${TONE_TEXT[tone]}`}
      >
        {voided ? (
          <span className="text-[4rem] text-pitch-50">Stakes refunded</span>
        ) : (
          <>
            <Icon name="check" className="h-[0.8em] w-[0.8em]" />
            {summary.winnerLabel ?? market.outcome}
          </>
        )}
      </motion.div>
      {!voided && (summary.winners.length > 0 || summary.losers.length > 0) && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="grid w-full max-w-[52rem] grid-cols-2 gap-4 text-left"
        >
          <div className="rounded-xl bg-up/10 p-3 ring-1 ring-up/50">
            <div className="mb-1 flex items-center gap-1.5 text-[0.85rem] font-bold uppercase tracking-widest text-up">
              <Icon name="up" className="h-4 w-4" /> Called it
            </div>
            {summary.winners.slice(0, 4).map((w) => (
              <div key={w.name} className="flex justify-between text-[1.3rem] font-semibold">
                <span>{w.name}</span>
                <span className="tabular text-pitch-200">{moneyShort(w.amount, party)} in</span>
              </div>
            ))}
            {summary.winners.length === 0 && <div className="text-[1.1rem] text-pitch-400">Nobody. Brutal.</div>}
          </div>
          <div className="rounded-xl bg-down/10 p-3 ring-1 ring-down/50">
            <div className="mb-1 flex items-center gap-1.5 text-[0.85rem] font-bold uppercase tracking-widest text-down">
              <Icon name="down" className="h-4 w-4" /> Cooked
            </div>
            {summary.losers.slice(0, 4).map((w) => (
              <div key={w.name} className="flex justify-between text-[1.3rem] font-semibold">
                <span>{w.name}</span>
                <span className="tabular text-pitch-200">{moneyShort(w.amount, party)} lost</span>
              </div>
            ))}
            {summary.losers.length === 0 && <div className="text-[1.1rem] text-pitch-400">Clean sweep.</div>}
          </div>
        </motion.div>
      )}
      {!voided && <p className="text-[0.95rem] text-pitch-400">20 seconds to flag a wrong result from your phone.</p>}
    </motion.div>
  );
}

/* ---------------- Dispute banner ---------------- */

export function DisputeBanner({ markets, players, onOpen }: { markets: Market[]; players: PlayerPublic[]; onOpen: () => void }) {
  const m = markets[0];
  if (!m) return null;
  const who = players.find((p) => p.pubkey === m.dispute?.by)?.name ?? 'A player';
  const label = m.outcomes.find((o) => o.id === m.outcome)?.label ?? m.outcome;
  return (
    <motion.button
      initial={{ y: -30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      onClick={onOpen}
      className="mx-3 mt-2 flex shrink-0 items-center gap-3 rounded-xl bg-down px-4 py-2 text-left text-down-ink"
      role="alert"
    >
      <Icon name="flag" className="h-6 w-6 shrink-0" />
      <span className="font-display text-[1.35rem] font-bold uppercase tracking-wide">Result disputed</span>
      <span className="min-w-0 flex-1 truncate text-[1rem] font-semibold">
        {who} flagged “{m.question}” → {label}
        {m.dispute?.reason ? `: ${m.dispute.reason}` : ''}
      </span>
      <span className="shrink-0 rounded-lg bg-down-ink px-3 py-1 font-display text-[1.05rem] font-bold uppercase text-down">
        Host decides{markets.length > 1 ? ` (${markets.length})` : ''}
      </span>
    </motion.button>
  );
}
