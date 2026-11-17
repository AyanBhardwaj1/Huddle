import type { Scorecard } from '@huddle/shared';
import { MarkerShape } from '@huddle/ui';
import { Icon } from '../components/ui';
import { brierBars } from '../lib/derive';

/** Friends = the room (flood, our accent); Model and Gemini are neutrals told apart by fill + shape + label. */
const BAR: Record<'room' | 'model' | 'gemini', string> = {
  room: 'bg-flood',
  model: 'bg-night-200',
  gemini: 'hd-tone-other-alt ring-1 ring-inset ring-night-200',
};
/** A coin flip on every question scores 0.25; scale bars so that sits at about 70% width. */
const SCALE_MAX = 0.36;

function Who({ id, label, best, big }: { id: 'room' | 'model' | 'gemini'; label: string; best: boolean; big: boolean }) {
  return (
    <span className={`flex w-[8rem] shrink-0 items-center gap-2 font-bold ${big ? 'text-title' : 'text-lead'} ${id === 'room' ? 'text-flood' : 'text-chalk'}`}>
      {id === 'model' && <MarkerShape shape="solid" className="shrink-0 text-night-200" />}
      {id === 'gemini' && <MarkerShape shape="hollow" className="shrink-0 text-night-200" />}
      {id === 'room' && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-flood" aria-hidden="true" />}
      {label}
      {best && <Icon name="crown" className="h-[0.85em] w-[0.85em] shrink-0 text-flood" title="Best forecast" />}
    </span>
  );
}

export function ScorecardPanel({ scorecard, compact = false }: { scorecard: Scorecard; compact?: boolean }) {
  const bars = brierBars(scorecard);
  const empty = scorecard.n === 0;
  return (
    <div className={`flex h-full min-h-0 flex-col ${compact ? 'gap-3' : 'gap-5'}`}>
      {compact ? (
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="q text-title leading-none">Who's smarter?</h2>
          <p className="text-small text-night-400">Brier score, shorter bar wins</p>
        </div>
      ) : (
        <div>
          <h2 className="q text-display leading-none">Who's smarter?</h2>
          <p className="mt-1 text-lead text-night-400">
            Friends vs. the model vs. Gemini, over {scorecard.n} {scorecard.n === 1 ? 'question' : 'questions'}
          </p>
        </div>
      )}
      <div className={`flex flex-col ${compact ? 'gap-2' : 'gap-3.5'}`}>
        {bars.map((b, i) => (
          <div key={b.id} className="flex items-center gap-4">
            <Who id={b.id} label={b.label} best={b.best} big={!compact} />
            <div className={`relative flex-1 overflow-hidden rounded-chip bg-night-800 ${compact ? 'h-4' : 'h-8'}`}>
              {b.value !== null && (
                <div
                  className={`hd-flood absolute inset-y-0 left-0 rounded-chip ${BAR[b.id]}`}
                  style={{
                    width: `${Math.max(3, Math.min(100, (b.value / SCALE_MAX) * 100))}%`,
                    ['--d' as string]: `${i * 140}ms`,
                    animationDelay: `${i * 140}ms`,
                  }}
                />
              )}
              <div className="absolute inset-y-0 border-l-2 border-dashed border-night-400" style={{ left: `${(0.25 / SCALE_MAX) * 100}%` }} aria-hidden="true" />
            </div>
            <span className={`num w-[4.5rem] text-right ${compact ? 'text-title' : 'text-head'}`}>{b.value === null ? '–' : b.value.toFixed(2)}</span>
          </div>
        ))}
      </div>
      {!compact && (
        <p className="text-body text-night-400">
          Brier score: how far each forecast landed from what happened. <b className="text-night-200">Shorter bar wins</b>; 0 is perfect, the dashed
          line is a coin flip.
          {scorecard.nGemini > 0 &&
            scorecard.nGemini < scorecard.n &&
            ` Gemini priced ${scorecard.nGemini} of ${scorecard.n} questions and is scored on those.`}
        </p>
      )}
      <p className={`q border-l-4 border-flood pl-4 leading-tight ${compact ? 'line-clamp-2 text-body' : 'text-head'}`}>
        {empty ? 'No results yet. The first settled question starts the scorecard.' : scorecard.verdict}
      </p>
      {!compact && scorecard.entries.length > 0 && (
        <table className="min-h-0 w-full text-body">
          <thead>
            <tr className="text-small text-night-400">
              <th className="pb-1 text-left font-normal">Question · what happened</th>
              <th className="w-[5rem] pb-1 text-right font-normal">Friends</th>
              <th className="w-[5rem] pb-1 text-right font-normal">Model</th>
              <th className="w-[5rem] pb-1 text-right font-normal">Gemini</th>
            </tr>
          </thead>
          <tbody>
            {scorecard.entries
              .slice(-4)
              .reverse()
              .map((e) => (
                <tr key={e.marketId} className="border-t border-night-700">
                  <td className="max-w-0 truncate py-1 text-night-200">
                    {e.question} · <b className="text-chalk">{e.outcome}</b>
                  </td>
                  <td className="num py-1 text-right text-lead text-flood">{Math.round(e.room * 100)}%</td>
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
