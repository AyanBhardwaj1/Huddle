import type { Scorecard, ScorecardEntry } from '../types';

/** Brier score for binary "probability given to what happened": mean of (p - 1)^2. Lower is better. */
export function brier(probsOfActual: number[]): number | null {
  if (probsOfActual.length === 0) return null;
  const sum = probsOfActual.reduce((a, p) => a + (p - 1) ** 2, 0);
  return sum / probsOfActual.length;
}

function fmt(x: number): string {
  return x.toFixed(2);
}

/** Friends vs. Model vs. Gemini (PRD section 6). */
export function buildScorecard(entries: ScorecardEntry[]): Scorecard {
  const withGemini = entries.filter((e) => typeof e.gemini === 'number');
  const room = brier(entries.map((e) => e.room));
  const model = brier(entries.map((e) => e.model));
  const gemini = brier(withGemini.map((e) => e.gemini!));
  const roomG = brier(withGemini.map((e) => e.room));
  const modelG = brier(withGemini.map((e) => e.model));

  let verdict = 'No resolved markets yet.';
  if (room !== null && model !== null) {
    const diff = Math.abs(room - model);
    if (diff < 0.005) verdict = 'The room and the model are dead even tonight';
    else if (room < model) verdict = `The room beat the model by ${fmt(diff)} tonight`;
    else verdict = `The model beat the room by ${fmt(diff)} tonight`;
    if (gemini !== null && roomG !== null && modelG !== null) {
      const best = Math.min(roomG, modelG);
      if (gemini < best - 0.005) verdict += '; Gemini still wins';
      else if (gemini > best + 0.005) verdict += roomG <= modelG ? '; and the room out-called Gemini' : '; and the model out-called Gemini';
      else verdict += '; Gemini is level with the best of them';
    }
    verdict += '.';
  }

  return {
    entries,
    n: entries.length,
    nGemini: withGemini.length,
    brier: { room, model, gemini, roomOnGeminiSubset: roomG, modelOnGeminiSubset: modelG },
    verdict,
  };
}
