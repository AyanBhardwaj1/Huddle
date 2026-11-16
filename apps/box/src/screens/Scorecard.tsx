import type { Scorecard } from '@huddle/shared';
import { motion } from 'framer-motion';
import { Icon } from '../components/ui';
import { brierBars } from '../lib/derive';

const BAR_COLOR = { room: 'bg-volt', model: 'bg-model', gemini: 'bg-gemini' } as const;
const TEXT_COLOR = { room: 'text-volt', model: 'text-model', gemini: 'text-gemini' } as const;
/** A coin flip on every question scores 0.25; scale bars so that sits at ~70% width. */
const SCALE_MAX = 0.36;

export function ScorecardPanel({ scorecard, compact = false }: { scorecard: Scorecard; compact?: boolean }) {
  const bars = brierBars(scorecard);
  const empty = scorecard.n === 0;
  return (
    <div className={`flex h-full flex-col ${compact ? 'gap-2' : 'gap-4'}`}>
      <div className="flex items-baseline gap-3">
        <h2 className={`font-display font-bold uppercase leading-none tracking-wide ${compact ? 'text-[1.8rem]' : 'text-[3rem]'}`}>Who's smarter?</h2>
        <span className="kicker">Friends vs. Model vs. Gemini</span>
      </div>
      <div className={`flex flex-col ${compact ? 'gap-2' : 'gap-3'}`}>
        {bars.map((b, i) => (
          <div key={b.id} className="flex items-center gap-3">
            <span className={`flex w-[8.5rem] shrink-0 items-center gap-1.5 font-display font-bold uppercase ${TEXT_COLOR[b.id]} ${compact ? 'text-[1.4rem]' : 'text-[2.1rem]'}`}>
              {b.best && <Icon name="crown" className="h-[0.8em] w-[0.8em] text-volt" aria-label="best" />}
              {b.label}
            </span>
            <div className={`relative flex-1 overflow-hidden rounded-full bg-pitch-800 ${compact ? 'h-5' : 'h-9'}`}>
              {b.value !== null && (
                <motion.div
                  className={`h-full rounded-full ${BAR_COLOR[b.id]} ${b.best ? '' : 'opacity-70'}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(3, Math.min(100, (b.value / SCALE_MAX) * 100))}%` }}
                  transition={{ delay: 0.15 * i, type: 'spring', stiffness: 80, damping: 18 }}
                />
              )}
              <div className="absolute inset-y-0 border-l-2 border-dashed border-pitch-400/60" style={{ left: `${(0.25 / SCALE_MAX) * 100}%` }} title="coin flip" />
            </div>
            <span className={`tabular w-[5rem] text-right font-display font-bold ${compact ? 'text-[1.5rem]' : 'text-[2.4rem]'}`}>
              {b.value === null ? '—' : b.value.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
      <p className={`text-pitch-400 ${compact ? 'text-[0.8rem]' : 'text-[1rem]'}`}>
        Brier score: how far each forecast was from what actually happened. <b className="text-pitch-200">Shorter bar wins</b> — 0 is perfect, the dashed line is a
        coin flip.
        {scorecard.nGemini > 0 && scorecard.nGemini < scorecard.n && ` Gemini priced ${scorecard.nGemini} of ${scorecard.n} questions and is scored on those.`}
      </p>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className={`rounded-xl bg-volt/10 px-4 py-3 font-display font-bold leading-tight text-volt ring-1 ring-volt/50 ${compact ? 'text-[1.4rem]' : 'text-[2.4rem]'}`}
      >
        {empty ? 'No results yet — the first resolved question starts the scorecard.' : scorecard.verdict}
      </motion.div>
      {!compact && scorecard.entries.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="grid grid-cols-[1fr_5rem_5rem_5rem] gap-x-3 gap-y-1 text-[1rem]">
            <span className="kicker text-[0.75rem]">Question · what happened</span>
            <span className="kicker text-right text-[0.75rem] text-volt">Room</span>
            <span className="kicker text-right text-[0.75rem] text-model">Model</span>
            <span className="kicker text-right text-[0.75rem] text-gemini">Gemini</span>
            {scorecard.entries
              .slice(-5)
              .reverse()
              .map((e) => (
                <div key={e.marketId} className="contents">
                  <span className="truncate text-pitch-200">
                    {e.question} · <b className="text-pitch-50">{e.outcome}</b>
                  </span>
                  <span className="tabular text-right font-semibold">{Math.round(e.room * 100)}%</span>
                  <span className="tabular text-right font-semibold">{Math.round(e.model * 100)}%</span>
                  <span className="tabular text-right font-semibold">{e.gemini === undefined ? '—' : `${Math.round(e.gemini * 100)}%`}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
