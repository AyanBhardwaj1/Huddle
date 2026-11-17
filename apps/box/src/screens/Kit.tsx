import { LockRing, Pct, Roll, SplitBar, SplitMarkers, Wordmark, payoutText } from '@huddle/ui';
import { useEffect, useState } from 'react';

/**
 * `?fixture=kit`: the Floodlight design kit on one screen (type, colour, the shared motion
 * components running on a loop). Review only; nothing links here.
 */
export function Kit() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), 1800);
    return () => clearInterval(t);
  }, []);
  const yes = [0.77, 0.71, 0.74, 0.66, 0.81][n % 5]!;
  const secs = 20 - ((n * 2) % 21);
  const state = secs === 0 ? 'locked' : secs <= 5 ? 'urgent' : 'open';
  return (
    <main className="grid h-full grid-cols-[1.2fr_1fr] gap-8 overflow-hidden bg-night-950 p-8 text-chalk">
      <section className="flex min-w-0 flex-col gap-5">
        <Wordmark className="text-title" />
        <div className="font-display text-giant font-black stretch-condensed tnum">
          <Pct p={yes} arrow />
        </div>
        <h1 className="font-display text-head font-extrabold stretch-semi text-balance">Ronaldo steps up. Does he score?</h1>
        <SplitBar
          className="h-6 rounded-chip"
          parts={[
            { id: 'yes', label: 'Yes', p: yes },
            { id: 'no', label: 'No', p: 1 - yes },
          ]}
        />
        <SplitMarkers
          className="-mb-4 text-lead text-night-200"
          markers={[
            { id: 'model', label: 'Model 77', p: 0.77, shape: 'solid' },
            { id: 'gem', label: 'Gemini 74', p: 0.74, shape: 'hollow' },
          ]}
        />
        <SplitBar
          className="h-6 rounded-chip"
          parts={[
            { id: 'POR', label: 'Portugal', p: 0.46 },
            { id: 'draw', label: 'Draw', p: 0.27 },
            { id: 'ESP', label: 'Spain', p: 0.27 },
          ]}
        />
        <p className="text-lead text-night-200">
          {payoutText(yes, { points: true })} · {payoutText(0.0065, { points: true })} · {payoutText(undefined)}
        </p>
        <p className="font-display text-display font-black stretch-condensed tnum">
          <Roll text={`$${(12.5 + n * 1.25).toFixed(2)}`} arrow />
        </p>
      </section>
      <section className="flex flex-col items-start gap-6">
        <LockRing fraction={secs / 20} label={state === 'locked' ? null : String(secs)} state={state} size="13rem" caption="to lock" />
        <div className="flex flex-wrap gap-2 text-small">
          {['bg-night-950', 'bg-night-900', 'bg-night-800', 'bg-night-700', 'bg-night-400', 'bg-chalk', 'bg-flood', 'bg-yes', 'bg-no', 'bg-other'].map(
            (c) => (
              <span key={c} className={`h-12 w-12 rounded-chip ring-1 ring-night-700 ${c}`} title={c} />
            ),
          )}
        </div>
        <div className="font-sans text-body text-night-200">
          Atkinson Hyperlegible Next for reading. Archivo for numbers: <span className="tnum font-display font-bold">0123456789</span>
        </div>
      </section>
    </main>
  );
}
