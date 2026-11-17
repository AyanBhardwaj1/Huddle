import type { PlayerPublic } from '@huddle/shared';
import { Icon, MarkerShape, SPRING, pctText, useReducedMotion } from '@huddle/ui';
import { motion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ammCashOutValue, holdingsFor, marketResult, rankPlayers } from '../lib/markets';
import { money } from '../lib/money';
import { cx, useParty } from './ctx';
import { ResultBadge } from './MarketCard';
import { Avatar, Empty, Money, SectionTitle } from './primitives';
import { tone } from './tones';

/** Rank changes since the last render: pubkey -> places gained (board-reorder's ▲). */
function useClimbers(ranked: PlayerPublic[]): Map<string, number> {
  const prev = useRef<Map<string, number> | null>(null);
  const [climbers, setClimbers] = useState<Map<string, number>>(new Map());
  const order = ranked.map((p) => p.pubkey).join(',');
  useEffect(() => {
    const now = new Map(ranked.map((p, i) => [p.pubkey, i]));
    const before = prev.current;
    prev.current = now;
    if (!before) return;
    const up = new Map<string, number>();
    now.forEach((i, k) => {
      const was = before.get(k);
      if (was != null && was > i) up.set(k, was - i);
    });
    if (!up.size) return;
    setClimbers(up);
    const t = setTimeout(() => setClimbers(new Map()), 1600);
    return () => clearTimeout(t);
  }, [order]);
  return climbers;
}

/** The leaderboard: rows reorder on a spring (board-reorder); whoever climbs flashes ▲. */
export function Leaderboard({ title = 'Leaders' }: { title?: string }) {
  const { snap, me, points } = useParty();
  const reduce = useReducedMotion();
  const ranked = rankPlayers(snap.players);
  const climbers = useClimbers(ranked);
  return (
    <section aria-labelledby="board-title">
      <SectionTitle id="board-title">{title}</SectionTitle>
      {ranked.length ? (
        <ol className="overflow-hidden rounded-panel bg-card">
          {ranked.map((p, i) => {
            const mine = p.pubkey === me;
            const climbed = climbers.get(p.pubkey);
            return (
              <motion.li
                layout={reduce ? false : 'position'}
                transition={SPRING.reorder}
                key={p.pubkey}
                className={cx('relative flex min-h-16 items-center gap-3 px-4 py-3', i > 0 && 'border-t border-rule', mine && 'bg-canvas')}
              >
                {mine && <span className="absolute inset-y-0 left-0 w-1 bg-zap" aria-hidden="true" />}
                <span
                  className={cx(
                    'w-7 shrink-0 text-center font-display text-title font-extrabold stretch-condensed tnum',
                    i === 0 ? 'text-ink' : 'text-ink-muted',
                  )}
                >
                  {i + 1}
                </span>
                <Avatar name={p.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-bold text-ink">{p.name}</span>
                    {mine && <span className="text-small text-ink-muted">you</span>}
                    {i === 0 && <Icon name="crown" size={16} className="shrink-0 text-ink-2" title="Leading" />}
                    {climbed && (
                      <span className="hd-pop flex items-center gap-0.5 text-cap font-bold text-yes-600" style={{ ['--d' as string]: '200ms' }}>
                        <Icon name="up" size={10} /> {climbed}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-cap text-ink-muted">
                    {p.remote && (
                      <span className="flex items-center gap-1">
                        <Icon name="globe" size={12} /> Remote
                      </span>
                    )}
                    {!p.connected && <span>Away</span>}
                    {p.streak != null && Math.abs(p.streak) >= 2 ? (
                      <span className={cx('font-semibold', p.streak > 0 ? 'text-yes-600' : 'text-no-600')}>
                        {p.streak > 0 ? `${p.streak} wins in a row` : `${-p.streak} losses in a row`}
                      </span>
                    ) : (
                      <span className="tnum">in for {money(p.deposited, points)}</span>
                    )}
                  </div>
                </div>
                <span
                  className={cx(
                    'flex shrink-0 items-center gap-1 font-display text-lead font-extrabold stretch-condensed',
                    p.pnl > 0 ? 'text-yes-600' : p.pnl < 0 ? 'text-no-600' : 'text-ink-2',
                  )}
                >
                  {p.pnl !== 0 && <Icon name={p.pnl > 0 ? 'up' : 'down'} size={11} />}
                  <Money value={p.pnl} points={points} signed flash={false} />
                </span>
              </motion.li>
            );
          })}
        </ol>
      ) : (
        <Empty mark>Nobody's in yet. Share the code and the board fills up.</Empty>
      )}
    </section>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('overflow-hidden rounded-panel bg-card', className)}>{children}</div>;
}

export function MyBets() {
  const { snap, me, points, positions } = useParty();
  const open = snap.markets.filter((m) => (m.state === 'open' || m.state === 'locked') && holdingsFor(m, positions).length);
  const history = snap.markets
    .filter((m) => ['resolved', 'final', 'disputed', 'voided'].includes(m.state))
    .map((m) => ({ m, res: marketResult(m, positions, snap.fills, me) }))
    .filter((x) => x.res.kind !== 'none')
    .sort((a, b) => Date.parse(b.m.resolvedAt ?? b.m.createdAt) - Date.parse(a.m.resolvedAt ?? a.m.createdAt));
  const offers = snap.offers.filter((o) => o.maker === me && o.open && o.filled < o.makerStake);
  const openRows = open.flatMap((m) => holdingsFor(m, positions).map((h) => ({ m, h })));

  return (
    <div className="space-y-8">
      <section aria-labelledby="open-title">
        <SectionTitle id="open-title" count={openRows.length + offers.length}>
          In play
        </SectionTitle>
        {openRows.length || offers.length ? (
          <Panel>
            {openRows.map(({ m, h }, i) => {
              const idx = m.outcomes.findIndex((o) => o.id === h.outcome);
              const t = tone(idx, m.outcomes.length);
              const value = m.mode === 'amm' ? ammCashOutValue(m, h.shares, h.outcome) : null;
              return (
                <div key={m.id + h.outcome} className={cx('relative py-3 pl-5 pr-4', i > 0 && 'border-t border-rule')}>
                  <span className={cx('absolute inset-y-3 left-0 w-1 rounded-r-full', t.rule)} aria-hidden="true" />
                  <p className="text-small text-ink-2">{m.question}</p>
                  <div className="mt-1 flex items-baseline justify-between gap-3">
                    <span className="font-display text-lead font-bold stretch-semi">
                      <span className="tnum">{money(h.stake, points)}</span> on <span className={t.text}>{m.outcomes[idx]?.label}</span>
                    </span>
                    <span className="shrink-0 text-cap text-ink-muted">
                      {value != null ? 'worth ' : 'pays about '}
                      <Money value={value ?? h.potential} points={points} className="text-small font-bold text-ink" />
                    </span>
                  </div>
                  {m.state === 'locked' && (
                    <p className="mt-1 flex items-center gap-1.5 text-cap text-ink-muted">
                      <Icon name="lock" size={13} /> Locked, waiting for the result
                    </p>
                  )}
                </div>
              );
            })}
            {offers.map((o, i) => {
              const m = snap.markets.find((x) => x.id === o.marketId);
              return (
                <div key={o.id} className={cx('py-3 pl-5 pr-4', (i > 0 || openRows.length > 0) && 'border-t border-rule')}>
                  <p className="text-small text-ink-2">{m?.question}</p>
                  <p className="mt-1 text-body text-ink">
                    Your offer: <span className="font-display font-bold tnum">{money(o.makerStake - o.filled, points)}</span> unmatched at{' '}
                    <span className="font-display font-bold tnum">{o.odds.toFixed(2)}</span>
                  </p>
                </div>
              );
            })}
          </Panel>
        ) : (
          <Empty>Nothing in play. Pick a side on a question and it shows up here.</Empty>
        )}
      </section>
      <section aria-labelledby="history-title">
        <SectionTitle id="history-title" count={history.length}>
          Settled
        </SectionTitle>
        {history.length ? (
          <Panel>
            {history.map(({ m, res }, i) => (
              <div key={m.id} className={cx('flex items-center justify-between gap-3 px-4 py-3', i > 0 && 'border-t border-rule')}>
                <div className="min-w-0">
                  <p className="text-small text-ink-2">{m.question}</p>
                  <p className="text-cap text-ink-muted">
                    {m.state === 'voided' ? 'Voided' : `Result: ${m.outcomes.find((o) => o.id === m.outcome)?.label ?? '–'}`}
                    {m.state === 'disputed' && ', under review'}
                  </p>
                </div>
                <span className="shrink-0 text-small">
                  <ResultBadge res={res} points={points} />
                </span>
              </div>
            ))}
          </Panel>
        ) : (
          <Empty>Results land here the moment a question settles.</Empty>
        )}
      </section>
    </div>
  );
}

/** Friends vs. Model vs. Gemini: Brier scores, and each question on one 0 to 100 axis. */
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
    { k: 'room', label: 'Friends', v: b.room, mark: <span className="h-2.5 w-2.5 rounded-full bg-zap" />, num: 'text-zap' },
    { k: 'model', label: 'Model', v: b.model, mark: <MarkerShape shape="solid" className="text-ink-2" />, num: 'text-ink' },
    { k: 'gemini', label: 'Gemini', v: b.gemini, mark: <MarkerShape shape="hollow" className="text-ink-2" />, num: 'text-ink' },
  ];
  return (
    <section className="space-y-5" aria-labelledby="score-title">
      <div>
        <SectionTitle id="score-title">Friends vs. Model vs. Gemini</SectionTitle>
        <p className="-mt-2 text-pretty text-small text-ink-muted">
          Who called tonight best. Brier score: lower is better. {sc.n} {sc.n === 1 ? 'question' : 'questions'} settled
          {sc.nGemini ? `, ${sc.nGemini} with a Gemini price` : ''}.
        </p>
      </div>
      <dl className="grid grid-cols-3 divide-x divide-rule rounded-panel bg-card py-4">
        {tiles.map((t) => (
          <div key={t.k} className="px-3 text-center">
            <dt className="flex items-center justify-center gap-1.5 text-small font-semibold text-ink-2">
              {t.mark}
              {t.label}
            </dt>
            <dd className={cx('mt-1 font-display text-head font-extrabold stretch-condensed tnum', t.v == null ? 'text-ink-faint' : t.num)}>
              {t.v == null ? '–' : t.v.toFixed(3)}
            </dd>
            <dd className={cx('mt-0.5 flex h-5 items-center justify-center gap-1 text-cap', best === t.k ? 'text-ink' : 'invisible')}>
              <Icon name="crown" size={13} /> Leading
            </dd>
          </div>
        ))}
      </dl>
      {sc.verdict && <p className="text-balance font-display text-title font-bold stretch-semi">{sc.verdict}</p>}
      {sc.entries.length ? (
        <Panel>
          <p className="border-b border-rule px-4 py-2.5 text-cap text-ink-muted">Chance each gave to what actually happened. Further right is better.</p>
          {sc.entries.map((e, i) => (
            <div key={e.marketId} className={cx('px-4 py-3.5', i > 0 && 'border-t border-rule')}>
              <p className="text-small text-ink">{e.question}</p>
              <p className="text-cap text-ink-muted">Happened: {e.outcome}</p>
              <Axis room={e.room} model={e.model} gemini={e.gemini} />
            </div>
          ))}
        </Panel>
      ) : (
        <Empty mark>The scorecard fills in as questions settle.</Empty>
      )}
    </section>
  );
}

/** One question's forecasts on a 0 to 100 axis: the room's dot, Model ▼, Gemini ▽, with numbers. */
function Axis({ room, model, gemini }: { room: number; model: number; gemini?: number }) {
  const pos = (p: number) => ({ left: `${Math.min(100, Math.max(0, p * 100))}%` });
  return (
    <div className="mt-2">
      <div className="relative mx-1.5 h-5" aria-hidden="true">
        <div className="absolute inset-x-0 top-1/2 h-px bg-rule" />
        <span className="absolute top-0 -translate-x-1/2 text-ink-2" style={pos(model)}>
          <MarkerShape shape="solid" />
        </span>
        {gemini != null && (
          <span className="absolute top-0 -translate-x-1/2 text-ink-2" style={pos(gemini)}>
            <MarkerShape shape="hollow" />
          </span>
        )}
        <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zap ring-2 ring-card" style={pos(room)} />
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 text-cap text-ink-muted">
        <span>
          Friends <b className="font-display text-zap tnum">{pctText(room)}%</b>
        </span>
        <span>
          Model <b className="font-display text-ink-2 tnum">{pctText(model)}%</b>
        </span>
        <span>
          Gemini <b className="font-display text-ink-2 tnum">{gemini == null ? '–' : `${pctText(gemini)}%`}</b>
        </span>
      </p>
    </div>
  );
}
