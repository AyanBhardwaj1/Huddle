import type { Scorecard } from '@huddle/shared';
import { Kinetic, MarkerShape, Roll } from '@huddle/ui';
import type { CSSProperties } from 'react';
import { Icon } from '../components/ui';
import { brierBars } from '../lib/derive';

/** Friends = the room (zap, our accent); Model and Gemini are ink, told apart by fill + shape + label. */
const BAR: Record<'room' | 'model' | 'gemini', string> = {
  room: 'bg-prime',
  model: 'bg-ink',
  gemini: 'hd-tone-other-alt ring-2 ring-inset ring-ink',
};
/** A coin flip on every question scores 0.25; scale bars so that sits at about 70% width. */
const SCALE_MAX = 0.36;

function Who({ id, label, best, big }: { id: 'room' | 'model' | 'gemini'; label: string; best: boolean; big: boolean }) {
  return (
    <span className={`flex w-[8.5rem] shrink-0 items-center gap-2 font-head font-extrabold ${big ? 'text-title' : 'text-lead'} ${id === 'room' ? 'text-zap' : 'text-ink'}`}>
      {id === 'model' && <MarkerShape shape="solid" className="shrink-0" />}
      {id === 'gemini' && <MarkerShape shape="hollow" className="shrink-0" />}
      {id === 'room' && <span className="h-3 w-3 shrink-0 rounded-full bg-zap" aria-hidden="true" />}
      {label}
      {best && (
        <span className="hd-pop flex h-[1.4em] w-[1.4em] shrink-0 items-center justify-center rounded-full bg-gold text-gold-on shadow-gold" style={{ ['--d' as string]: '900ms' } as CSSProperties}>
          <Icon name="crown" className="h-[0.8em] w-[0.8em]" title="Best forecast" />
        </span>
      )}
    </span>
  );
}

export function ScorecardPanel({ scorecard, compact = false, stage = false }: { scorecard: Scorecard; compact?: boolean; stage?: boolean }) {
  const bars = brierBars(scorecard);
  const empty = scorecard.n === 0;
  return (
    <div className={`flex h-full min-h-0 flex-col ${compact ? 'gap-2' : stage ? 'gap-3' : 'gap-4'}`}>
      {compact ? (
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="q text-title leading-none">Who’s smarter?</h2>
          <p className="text-small text-ink-2">Brier score, shorter bar wins</p>
        </div>
      ) : (
        <div>
          <h2 className={`q leading-none ${stage ? 'text-head' : 'text-display'}`}>
            <Kinetic text="Who’s smarter?" />
          </h2>
          <p className="hd-fade mt-1.5 text-lead text-ink-2" style={{ ['--d' as string]: '250ms' } as CSSProperties}>
            Friends vs. the model vs. Gemini, over {scorecard.n} {scorecard.n === 1 ? 'question' : 'questions'}
          </p>
        </div>
      )}
      <div className={`flex flex-col ${compact ? 'gap-1.5' : stage ? 'gap-2' : 'gap-3'}`}>
        {bars.map((b, i) => (
          <div key={b.id} className="flex items-center gap-4">
            <Who id={b.id} label={b.label} best={b.best} big={!compact} />
            <div className={`relative flex-1 overflow-hidden rounded-full bg-well ${compact ? 'h-3.5' : stage ? 'h-6' : 'h-8'}`}>
              {b.value !== null && (
                <div
                  className={`hd-flood absolute inset-y-0 left-0 rounded-full ${BAR[b.id]}`}
                  style={{
                    width: `${Math.max(3, Math.min(100, (b.value / SCALE_MAX) * 100))}%`,
                    ['--d' as string]: `${200 + i * 160}ms`,
                  }}
                />
              )}
              <div className="absolute inset-y-0 border-l-2 border-dashed border-ink-muted" style={{ left: `${(0.25 / SCALE_MAX) * 100}%` }} aria-hidden="true" />
            </div>
            <span className={`num w-[4.5rem] text-right ${compact ? 'text-title' : 'text-head'}`}>
              {b.value === null ? '–' : <Roll text={b.value.toFixed(2)} value={b.value} flash={false} />}
            </span>
          </div>
        ))}
      </div>
      {!compact && (
        <p className={stage ? 'shrink-0 text-small text-ink-2' : 'text-body text-ink-2'}>
          Brier score: how far each forecast landed from what happened. <b className="text-ink">Shorter bar wins</b>; 0 is perfect, the dashed line is
          a coin flip.
          {scorecard.nGemini > 0 &&
            scorecard.nGemini < scorecard.n &&
            ` Gemini priced ${scorecard.nGemini} of ${scorecard.n} questions and is scored on those.`}
        </p>
      )}
      <p
        className={`hd-rise q shrink-0 rounded-panel bg-prime-soft leading-tight text-ink ring-1 ring-inset ring-zap-100 ${compact ? 'px-3 py-1.5 text-body' : stage ? 'px-4 py-2 text-lead' : 'px-4 py-2.5 text-head'}`}
        style={{ ['--d' as string]: '700ms' } as CSSProperties}
      >
        {/* Clamp an inner span so the padding never shows a sliver of the next line. */}
        <span className={compact ? 'line-clamp-2' : stage ? 'line-clamp-2' : ''}>
          {empty ? 'No results yet. The first settled question starts the scorecard.' : scorecard.verdict}
        </span>
      </p>
      {!compact && !stage && scorecard.entries.length > 0 && (
        <table className="min-h-0 w-full text-body">
          <thead>
            <tr className="text-small text-ink-2">
              <th className="pb-1 text-left font-semibold">Question · what happened</th>
              <th className="w-[5rem] pb-1 text-right font-semibold">Friends</th>
              <th className="w-[5rem] pb-1 text-right font-semibold">Model</th>
              <th className="w-[5rem] pb-1 text-right font-semibold">Gemini</th>
            </tr>
          </thead>
          <tbody>
            {scorecard.entries
              .slice(-4)
              .reverse()
              .map((e, i) => (
                <tr key={e.marketId} className="hd-rise border-t border-rule" style={{ ['--d' as string]: `${800 + i * 70}ms` } as CSSProperties}>
                  <td className="max-w-0 truncate py-1 text-ink-2">
                    {e.question} · <b className="text-ink">{e.outcome}</b>
                  </td>
                  <td className="num py-1 text-right text-lead text-zap">{Math.round(e.room * 100)}%</td>
                  <td className="num py-1 text-right text-lead">{Math.round(e.model * 100)}%</td>
                  <td className="num py-1 text-right text-lead">{e.gemini === undefined ? '–' : `${Math.round(e.gemini * 100)}%`}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
