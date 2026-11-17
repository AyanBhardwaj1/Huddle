import { Aurora, Avatar, Burst, Icon, Kinetic, LockRing, MarkerShape, Pct, Roll, Sparkline, SplitBar, SplitMarkers, Wordmark, payoutText, type SeriesPoint } from '@huddle/ui';
import { useEffect, useState } from 'react';

const QUESTIONS = ['Ronaldo steps up. Does he score?', 'Corner. Header on target?', 'Spain equalise before the 80th?'];
const SWATCHES: [string, string][] = [
  ['bg-canvas ring-1 ring-rule', 'canvas'],
  ['bg-card ring-1 ring-rule', 'card'],
  ['bg-well', 'well'],
  ['bg-ink', 'ink'],
  ['bg-ink-2', 'ink-2'],
  ['bg-ink-muted', 'muted'],
  ['bg-zap', 'zap'],
  ['bg-prime', 'prime'],
  ['bg-yes', 'yes'],
  ['bg-no', 'no'],
  ['hd-tone-other', 'sun'],
  ['hd-tone-other-alt', 'lilac'],
  ['bg-hot', 'hot'],
  ['bg-gold', 'gold'],
];

/**
 * `?fixture=kit`: the Kickoff design kit on one screen (type, colour, buttons, the shared motion
 * components running on a loop). Review only; nothing links here.
 */
export function Kit() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), 1800);
    return () => clearInterval(t);
  }, []);
  const yes = [0.71, 0.74, 0.69, 0.77, 0.81, 0.78][n % 6]!;
  const secs = 20 - ((n * 2) % 22);
  const state = secs <= 0 ? 'locked' : secs <= 5 ? 'urgent' : 'open';
  const [pts, setPts] = useState<SeriesPoint[]>([{ t: 0, p: 0.77 }]);
  useEffect(() => {
    setPts((p) => [...p, { t: n, p: yes }].slice(-24));
  }, [n, yes]);
  return (
    <main className="relative grid h-full grid-cols-[1.25fr_1fr] gap-5 overflow-hidden bg-canvas p-6 text-ink">
      <Aurora />
      <section className="relative flex min-w-0 flex-col gap-4">
        <div className="flex items-center gap-4">
          <Wordmark className="text-title" lit={12} />
          <span className="text-body text-ink-2">Kickoff · design kit</span>
        </div>
        <div className="card relative flex flex-col gap-2.5 overflow-hidden rounded-blob p-4 shadow-pop">
          <span className="absolute inset-x-0 top-0 h-1.5 bg-prime" aria-hidden="true" />
          <span className="flex w-fit items-center gap-2 rounded-full bg-prime-deep px-3 py-1 text-body font-bold text-white shadow-zap">
            <Icon name="bolt" className="h-4 w-4" /> Moment market
          </span>
          <h1 className="q text-head leading-[1.02]">
            <Kinetic text={QUESTIONS[Math.floor(n / 4) % QUESTIONS.length]!} />
          </h1>
          <div className="grid grid-cols-2 gap-3">
            <div className="on-fill flex flex-col rounded-panel bg-yes px-4 py-3 text-yes-on shadow-yes">
              <span className="font-head text-title font-extrabold">Yes</span>
              <span className="num text-display leading-[0.9]">
                <Pct p={yes} arrow />
              </span>
              <span className="text-body font-semibold">{payoutText(yes, { points: true })}</span>
            </div>
            <div className="on-fill flex flex-col rounded-panel bg-no px-4 py-3 text-no-on shadow-no">
              <span className="font-head text-title font-extrabold">No</span>
              <span className="num text-display leading-[0.9]">
                <Pct p={1 - yes} arrow />
              </span>
              <span className="text-body font-semibold">{payoutText(1 - yes, { points: true })}</span>
            </div>
          </div>
          <SplitMarkers
            className="-mb-2 text-lead text-ink"
            markers={[
              { id: 'model', label: 'Model 77', p: 0.77, shape: 'solid' },
              { id: 'gem', label: 'Gemini 74', p: 0.74, shape: 'hollow' },
            ]}
          />
          <SplitBar
            className="h-4 rounded-full"
            parts={[
              { id: 'yes', label: 'Yes', p: yes },
              { id: 'no', label: 'No', p: 1 - yes },
            ]}
          />
          <SplitBar
            className="h-4 rounded-full"
            parts={[
              { id: 'POR', label: 'Portugal', p: 0.46 },
              { id: 'draw', label: 'Draw', p: 0.27 },
              { id: 'ESP', label: 'Spain', p: 0.27 },
            ]}
          />
          <p className="flex items-center gap-4 text-body text-ink-2">
            <span className="flex items-center gap-1.5">
              <MarkerShape shape="solid" /> Model 77%
            </span>
            <span className="flex items-center gap-1.5">
              <MarkerShape shape="hollow" /> Gemini 74%
            </span>
            <span>{payoutText(0.0065, { points: true })}</span>
            <span>{payoutText(undefined)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-prime">
            Start game <Icon name="play" className="h-5 w-5" />
          </button>
          <button type="button" className="btn-primary">
            <Icon name="lock" className="h-5 w-5" /> Lock
          </button>
          <button type="button" className="btn-secondary">
            <Icon name="mic" className="h-5 w-5" /> Talk
          </button>
          <button type="button" className="btn-yes">Yes</button>
          <button type="button" className="btn-secondary" disabled>
            Disabled
          </button>
        </div>
      </section>
      <section className="relative flex min-w-0 flex-col gap-4">
        <div className="flex items-center gap-5">
          <div className="card flex items-center justify-center rounded-blob p-3 shadow-pop">
            <LockRing fraction={Math.max(0, secs) / 20} label={state === 'locked' ? null : String(secs)} state={state} size="9rem" caption="to lock" />
          </div>
          <div className="card relative flex min-w-0 flex-1 flex-col overflow-hidden px-4 py-3">
            <span className="text-body font-semibold text-ink-2">In the pot</span>
            <span className="num text-display leading-[0.95]">
              <Roll text={`$${(12.5 + n * 1.25).toFixed(2)}`} arrow duration={800} />
            </span>
            {n % 5 === 0 && n > 0 && <Burst seed={n} count={20} spread={9} />}
          </div>
        </div>
        <div className="card px-4 py-3">
          <p className="flex justify-between text-small font-semibold text-ink-2">
            <span>Yes price</span>
            <span className="num text-lead text-yes-600">{Math.round(yes * 100)}%</span>
          </p>
          <Sparkline points={pts} className="mt-1 h-[3.5rem] w-full" stroke="#1468FF" fill="rgba(20,104,255,0.14)" />
        </div>
        <div className="flex items-center gap-2">
          {['Priya', 'Jake', 'Ayan', 'Mia', 'Leo', 'Sam'].map((name, i) => (
            <span key={name} className="hd-pop" style={{ ['--d' as string]: `${i * 70}ms` }}>
              <Avatar name={name} size="2.5rem" />
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {SWATCHES.map(([c, label]) => (
            <span key={label} className="flex flex-col items-center gap-1 text-cap text-ink-2">
              <span className={`h-10 w-full rounded-chip ${c}`} />
              {label}
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-head text-title font-extrabold leading-none tracking-[-0.03em]">Bricolage for words</p>
          <p className="num text-head leading-none">0123456789 $12.50</p>
          <p className="text-body text-ink-2">Atkinson Hyperlegible Next for everything people read at 3 m.</p>
        </div>
      </section>
    </main>
  );
}
