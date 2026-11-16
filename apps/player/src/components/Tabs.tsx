import { formatPct } from '@huddle/shared';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ammCashOutValue, holdingsFor, marketResult, rankPlayers } from '../lib/markets';
import { money, pnl } from '../lib/money';
import { cx, useParty } from './ctx';
import { Icon } from './Icon';
import { ResultBadge, toneFor } from './MarketCard';
import { Pill, Ticker } from './primitives';

export function Leaderboard({ title = 'Leaderboard' }: { title?: string }) {
  const { snap, me, points } = useParty();
  const ranked = rankPlayers(snap.players);
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <ol className="space-y-2">
        {ranked.map((p, i) => (
          <motion.li
            layout
            key={p.pubkey}
            className={cx(
              'flex items-center gap-3 rounded-2xl border px-3 py-3',
              p.pubkey === me ? 'border-volt/40 bg-volt/[0.06]' : 'border-pitch-700 bg-pitch-900',
            )}
          >
            <span className={cx('w-7 text-center font-display text-2xl font-bold tnum', i === 0 ? 'text-volt' : 'text-pitch-400')}>{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-semibold text-pitch-50">{p.name}</span>
                {p.pubkey === me && <Pill className="bg-volt/20 text-volt">You</Pill>}
                {!p.connected && <span className="h-1.5 w-1.5 rounded-full bg-pitch-600" title="Offline" />}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-pitch-400">
                {p.remote && (
                  <span className="flex items-center gap-1 text-gemini">
                    <Icon name="globe" size={12} /> Remote
                  </span>
                )}
                {p.streak != null && Math.abs(p.streak) >= 2 && (
                  <span className={cx('font-semibold', p.streak > 0 ? 'text-up' : 'text-down')}>
                    {p.streak > 0 ? `${p.streak} wins in a row` : `${-p.streak} losses in a row`}
                  </span>
                )}
                {!p.remote && (p.streak == null || Math.abs(p.streak) < 2) && <span>in {money(p.deposited, points)}</span>}
              </div>
            </div>
            <div className={cx('flex items-center gap-1 font-display text-xl font-bold tnum', p.pnl > 0 ? 'text-up' : p.pnl < 0 ? 'text-down' : 'text-pitch-200')}>
              {p.pnl !== 0 && <Icon name={p.pnl > 0 ? 'up' : 'down'} size={14} />}
              <Ticker value={p.pnl} format={(v) => pnl(Math.round(v), points)} flash={false} />
            </div>
          </motion.li>
        ))}
      </ol>
      {!ranked.length && <Empty>No players yet.</Empty>}
    </section>
  );
}

export function MyBets() {
  const { snap, me, points } = useParty();
  const positions = snap.you?.positions ?? [];
  const open = snap.markets.filter((m) => (m.state === 'open' || m.state === 'locked') && holdingsFor(m, positions).length);
  const history = snap.markets
    .filter((m) => ['resolved', 'final', 'disputed', 'voided'].includes(m.state))
    .map((m) => ({ m, res: marketResult(m, positions, snap.fills, me) }))
    .filter((x) => x.res.kind !== 'none')
    .sort((a, b) => Date.parse(b.m.resolvedAt ?? b.m.createdAt) - Date.parse(a.m.resolvedAt ?? a.m.createdAt));
  const offers = snap.offers.filter((o) => o.maker === me && o.open && o.filled < o.makerStake);

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>Open</SectionTitle>
        <div className="space-y-2">
          {open.map((m) =>
            holdingsFor(m, positions).map((h) => {
              const idx = m.outcomes.findIndex((o) => o.id === h.outcome);
              const value = m.mode === 'amm' ? ammCashOutValue(m, h.shares, h.outcome) : null;
              return (
                <div key={m.id + h.outcome} className="rounded-2xl border border-pitch-700 bg-pitch-900 p-3">
                  <div className="text-sm text-pitch-200">{m.question}</div>
                  <div className="mt-1.5 flex items-baseline justify-between gap-2">
                    <span className="font-display text-xl font-bold">
                      <span className="tnum">{money(h.stake, points)}</span> on <span className={toneFor(idx).text}>{m.outcomes[idx]?.label}</span>
                    </span>
                    <span className="text-xs text-pitch-400 tnum">
                      {value != null ? `worth ${money(value, points)}` : `pays ≈ ${money(h.potential, points)}`}
                    </span>
                  </div>
                  {m.state === 'locked' && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-pitch-400">
                      <Icon name="lock" size={12} /> Locked, waiting for the result
                    </div>
                  )}
                </div>
              );
            }),
          )}
          {offers.map((o) => {
            const m = snap.markets.find((x) => x.id === o.marketId);
            return (
              <div key={o.id} className="rounded-2xl border border-dashed border-pitch-600 p-3 text-sm">
                <div className="text-pitch-200">{m?.question}</div>
                <div className="mt-1 text-pitch-50">
                  Your offer: {money(o.makerStake - o.filled, points)} unmatched at <span className="tnum">{o.odds.toFixed(2)}</span>
                </div>
              </div>
            );
          })}
          {!open.length && !offers.length && <Empty>No open bets. Tap a question to get in.</Empty>}
        </div>
      </section>
      <section>
        <SectionTitle>History</SectionTitle>
        <div className="space-y-2">
          {history.map(({ m, res }) => (
            <div key={m.id} className="flex items-center justify-between gap-3 rounded-2xl border border-pitch-700 bg-pitch-900 p-3">
              <div className="min-w-0">
                <div className="truncate text-sm text-pitch-200">{m.question}</div>
                <div className="text-xs text-pitch-400">
                  {m.state === 'voided' ? 'Voided' : `Result: ${m.outcomes.find((o) => o.id === m.outcome)?.label ?? '—'}`}
                </div>
              </div>
              <ResultBadge res={res} points={points} />
            </div>
          ))}
          {!history.length && <Empty>Settled bets show up here.</Empty>}
        </div>
      </section>
    </div>
  );
}

export function ScorecardView() {
  const { snap } = useParty();
  const sc = snap.scorecard;
  const b = sc.brier;
  const best = [
    { k: 'room', v: b.room },
    { k: 'model', v: b.model },
    { k: 'gemini', v: b.gemini },
  ]
    .filter((x) => x.v != null)
    .sort((x, y) => x.v! - y.v!)[0]?.k;
  const tiles = [
    { k: 'room', label: 'Friends', v: b.room, color: 'text-volt', ring: 'border-volt/40' },
    { k: 'model', label: 'Model', v: b.model, color: 'text-model', ring: 'border-model/40' },
    { k: 'gemini', label: 'Gemini', v: b.gemini, color: 'text-gemini', ring: 'border-gemini/40' },
  ];
  return (
    <section className="space-y-4">
      <SectionTitle>Friends vs. Model vs. Gemini</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div key={t.k} className={cx('rounded-2xl border bg-pitch-900 px-2 py-3 text-center', best === t.k ? t.ring : 'border-pitch-700')}>
            <div className={cx('font-display text-sm font-bold uppercase tracking-wider', t.color)}>{t.label}</div>
            <div className="font-display text-3xl font-bold tnum">{t.v == null ? '—' : t.v.toFixed(3)}</div>
            {best === t.k && <div className="text-[10px] font-semibold uppercase tracking-wider text-pitch-200">Leading</div>}
          </div>
        ))}
      </div>
      <p className="text-xs text-pitch-400">
        Brier score: lower is better. {sc.n} questions settled{sc.nGemini ? `, ${sc.nGemini} with a Gemini price` : ''}.
      </p>
      {sc.verdict && <p className="rounded-2xl bg-pitch-800 p-4 font-display text-xl font-semibold leading-snug">{sc.verdict}</p>}
      <div className="space-y-2">
        {sc.entries.map((e) => (
          <div key={e.marketId} className="rounded-2xl border border-pitch-700 bg-pitch-900 p-3">
            <div className="text-sm text-pitch-200">{e.question}</div>
            <div className="mt-1.5 grid grid-cols-3 text-center font-display text-lg font-bold tnum">
              <span className="text-volt">{formatPct(e.room)}</span>
              <span className="text-model">{formatPct(e.model)}</span>
              <span className={e.gemini == null ? 'text-pitch-600' : 'text-gemini'}>{e.gemini == null ? '—' : formatPct(e.gemini)}</span>
            </div>
            <div className="text-center text-[11px] text-pitch-400">chance each gave to what happened ({e.outcome})</div>
          </div>
        ))}
        {!sc.entries.length && <Empty>The scorecard fills in as questions settle.</Empty>}
      </div>
    </section>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-2.5 font-display text-sm font-bold uppercase tracking-[0.16em] text-pitch-400">{children}</h2>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-pitch-700 px-4 py-6 text-center text-sm text-pitch-400">{children}</p>;
}
