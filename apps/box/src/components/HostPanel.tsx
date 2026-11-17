import type { Market, MarketMode, Persona } from '@huddle/shared';
import { pctText } from '@huddle/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { activeMoment, disputed, drafts, MODE_LABEL, moneyShort, roomProb } from '../lib/derive';
import { useParty } from '../party';
import { useBox } from '../store';
import { Icon, Segmented, Toggle } from './ui';

const MODES: MarketMode[] = ['bet', 'pool', 'amm'];
const PERSONAS: { value: Persona; label: string }[] = [
  { value: 'soccer', label: 'Soccer' },
  { value: 'nfl', label: 'NFL' },
  { value: 'calm', label: 'Calm' },
];
const SPEEDS = [1, 2, 5, 10];
const LOCK_SECS = [20, 45, 120, 600];
const STATE_LABEL: Partial<Record<Market['state'], string>> = { open: 'Open', locked: 'Locked', disputed: 'Disputed', draft: 'Draft' };

function Section({ title, children, tone }: { title: string; children: ReactNode; tone?: 'alert' }) {
  return (
    <section className={`flex flex-col gap-2.5 border-t px-4 py-4 ${tone === 'alert' ? 'border-no-dim bg-no-deep/60' : 'border-night-700'}`}>
      <h3 className={`text-body font-bold ${tone === 'alert' ? 'text-no-bright' : 'text-night-200'}`}>{title}</h3>
      {children}
    </section>
  );
}

/** Two-tap confirm for destructive actions (the second tap within 3 s commits). */
function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = 'btn-secondary',
}: {
  label: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={`${armed ? 'btn-danger' : className} min-h-[2.75rem] text-body`}
      aria-live="polite"
      onClick={() => {
        clearTimeout(timer.current);
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 3000);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

function MarketRow({ m }: { m: Market }) {
  const { act, view } = useParty();
  const party = view.snapshot!.party;
  const [open, setOpen] = useState(false);
  const canSwitch = m.state === 'open' && m.volume === 0;
  return (
    <div className="rounded-tile bg-night-850">
      <button
        type="button"
        className="flex min-h-[3rem] w-full items-center gap-2.5 rounded-tile px-3 text-left transition-colors duration-quick hover:bg-night-800"
        onClick={() => setOpen((x) => !x)}
        aria-expanded={open}
      >
        <span className={`shrink-0 text-small font-bold ${m.state === 'open' ? 'text-flood' : 'text-night-400'}`}>{STATE_LABEL[m.state] ?? m.state}</span>
        <span className="min-w-0 flex-1 truncate text-body font-semibold">{m.question}</span>
        <span className="tnum shrink-0 text-small text-night-400">{moneyShort(m.volume, party)}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} className="h-4 w-4 shrink-0 text-night-400" />
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {m.state === 'open' && (
            <button type="button" className="btn-primary min-h-[2.75rem] text-body" onClick={() => void act({ action: 'lock', marketId: m.id })}>
              <Icon name="lock" className="h-5 w-5" /> Lock now
            </button>
          )}
          <p className="text-small text-night-400">Resolve as</p>
          <div className="grid grid-cols-2 gap-2">
            {m.outcomes.map((o) => (
              <ConfirmButton
                key={o.id}
                label={`${o.label} · ${pctText(roomProb(m, o.id))}%`}
                confirmLabel={`Confirm: ${o.label}`}
                onConfirm={() => void act({ action: 'resolve', marketId: m.id, outcome: o.id })}
              />
            ))}
          </div>
          <ConfirmButton
            label="Void and refund everyone"
            confirmLabel="Tap again to void"
            onConfirm={() => void act({ action: 'void', marketId: m.id, reason: 'host' })}
          />
          {canSwitch && (
            <>
              <p className="text-small text-night-400">Mode for this question</p>
              <Segmented
                label="Mode for this question"
                options={MODES.map((x) => ({ value: x, label: MODE_LABEL[x] }))}
                value={m.mode}
                onChange={(mode) => void act({ action: 'set_mode', mode, marketId: m.id })}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CustomMarket() {
  const { act, view } = useParty();
  const [q, setQ] = useState('');
  const [outcomes, setOutcomes] = useState(['Yes', 'No']);
  const [secs, setSecs] = useState(45);
  const valid = q.trim().length >= 3 && outcomes.filter((o) => o.trim()).length >= 2;
  const presets =
    view.snapshot?.game.sport === 'nfl'
      ? ['Score on this drive?', 'First down on this play?', 'Turnover before the quarter ends?']
      : ['Goal in the next 5 minutes?', 'Will the next shot be on target?', 'Another card before half time?'];
  return (
    <Section title="Ask your own question">
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setQ(p)}
            className="min-h-[2.5rem] rounded-chip bg-night-800 px-3 text-small text-night-200 transition-colors duration-quick hover:bg-night-700 hover:text-chalk"
          >
            {p}
          </button>
        ))}
      </div>
      <label htmlFor="host-question" className="hd-sr">
        Your question
      </label>
      <input
        id="host-question"
        name="host-question"
        autoComplete="off"
        value={q}
        onChange={(e) => setQ(e.target.value.slice(0, 140))}
        placeholder="Will he score from here…"
        className="min-h-[3rem] rounded-tile bg-night-800 px-3 text-lead text-chalk ring-1 ring-inset ring-night-600 placeholder:text-night-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flood"
      />
      <div className="flex flex-wrap gap-2">
        {outcomes.map((o, i) => (
          <div key={i} className="flex items-center rounded-tile bg-night-800 ring-1 ring-inset ring-night-600 focus-within:ring-2 focus-within:ring-flood">
            <input
              value={o}
              name={`outcome-${i + 1}`}
              autoComplete="off"
              onChange={(e) => setOutcomes(outcomes.map((x, j) => (j === i ? e.target.value.slice(0, 40) : x)))}
              className="h-11 w-[7rem] bg-transparent px-3 text-body text-chalk focus-visible:outline-none"
              aria-label={`Outcome ${i + 1}`}
            />
            {outcomes.length > 2 && (
              <button
                type="button"
                className="flex h-11 w-10 items-center justify-center text-night-400 hover:text-chalk"
                onClick={() => setOutcomes(outcomes.filter((_, j) => j !== i))}
                aria-label={`Remove outcome ${i + 1}`}
              >
                <Icon name="x" className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {outcomes.length < 6 && (
          <button
            type="button"
            className="btn-quiet min-h-[2.75rem] px-3 text-body"
            onClick={() => setOutcomes([...outcomes, `Option ${outcomes.length + 1}`])}
          >
            <Icon name="plus" className="h-4 w-4" /> Outcome
          </button>
        )}
      </div>
      <Segmented
        label="Lock after"
        options={LOCK_SECS.map((s) => ({ value: s, label: s < 60 ? `${s} s` : `${s / 60} min` }))}
        value={secs}
        onChange={setSecs}
      />
      <button
        type="button"
        className="btn-primary text-body"
        disabled={!valid}
        onClick={async () => {
          const ok = await act({
            action: 'create_market',
            question: q.trim(),
            outcomes: outcomes.map((o) => o.trim()).filter(Boolean),
            lockInSecs: secs,
          });
          if (ok) setQ('');
        }}
      >
        Open question
      </button>
    </Section>
  );
}

function ReplayControls() {
  const { act, view } = useParty();
  const r = view.snapshot!.replay;
  const [seek, setSeek] = useState<number | null>(null);
  if (!r) return null;
  const pos = seek ?? r.positionMs;
  const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  return (
    <Section title="Replay">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary min-h-[3rem] w-[3.5rem] px-0"
          onClick={() => void act({ action: r.playing ? 'pause_game' : 'start_game' }, r.playing ? 'Paused' : 'Playing')}
          aria-label={r.playing ? 'Pause' : 'Play'}
        >
          <Icon name={r.playing ? 'pause' : 'play'} className="h-5 w-5" strokeWidth={2.6} />
        </button>
        <Segmented
          className="flex-1"
          label="Replay speed"
          options={SPEEDS.map((s) => ({ value: s, label: `${s}x` }))}
          value={SPEEDS.includes(r.speed) ? r.speed : 1}
          onChange={(speed) => void act({ action: 'set_speed', speed }, `${speed}x speed`)}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="tnum w-[3.25rem] text-small text-night-200">{fmt(pos)}</span>
        <input
          type="range"
          min={0}
          max={r.durationMs}
          step={1000}
          value={pos}
          onChange={(e) => setSeek(Number(e.target.value))}
          onPointerUp={() => {
            if (seek !== null) void act({ action: 'seek', positionMs: Math.round(seek) }, `Jumped to ${fmt(seek)}`);
            setSeek(null);
          }}
          onKeyUp={() => {
            if (seek !== null) void act({ action: 'seek', positionMs: Math.round(seek) });
            setSeek(null);
          }}
          className="h-10 flex-1 accent-[#FFE27A]"
          aria-label="Seek replay"
        />
        <span className="tnum w-[3.25rem] text-right text-small text-night-400">{fmt(r.durationMs)}</span>
      </div>
      <p className="tnum text-small text-night-400">
        Event {r.seq} of {r.totalEvents}
      </p>
    </Section>
  );
}

/**
 * Host controls, docked to the right of the party screen: the board shrinks to make room instead
 * of being covered (NEXT / N opens and cycles; Esc closes).
 */
export function HostPanel() {
  const { act, view } = useParty();
  const setView = useBox((s) => s.setView);
  const s = view.snapshot!;
  const cfg = s.party.config;
  const active = s.markets.filter((m) => m.state === 'open' || m.state === 'locked');
  const current = activeMoment(s.markets);
  const ds = disputed(s.markets);
  const dr = drafts(s.markets);

  return (
    <aside
      className="dock-in flex h-full min-h-0 w-[23rem] flex-col border-l border-night-700 bg-night-900"
      aria-label="Host controls"
      data-testid="host-controls"
    >
      <div className="flex h-[3.75rem] shrink-0 items-center gap-3 px-4">
        <Icon name="settings" className="h-6 w-6 text-flood" />
        <h2 className="text-title font-bold">Host controls</h2>
        <button type="button" className="btn-quiet ml-auto min-h-[2.75rem] px-3" onClick={() => setView('board')} aria-label="Close host controls (Esc)">
          <Icon name="x" className="h-5 w-5" />
        </button>
      </div>
      <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
        {current?.state === 'open' && (
          <div className="px-4 pb-4">
            <button
              type="button"
              className="btn-primary min-h-[3.75rem] w-full text-title"
              onClick={() => void act({ action: 'lock', marketId: current.id })}
              data-testid="host-lock"
            >
              <Icon name="lock" className="h-6 w-6" /> Lock now
            </button>
          </div>
        )}

        {ds.length > 0 && (
          <Section title={`Disputed (${ds.length})`} tone="alert">
            {ds.map((m) => {
              const who = s.players.find((p) => p.pubkey === m.dispute?.by)?.name ?? 'A player';
              const cur = m.outcomes.find((o) => o.id === m.outcome)?.label ?? m.outcome;
              return (
                <div key={m.id} className="flex flex-col gap-2">
                  <p className="text-body font-semibold">{m.question}</p>
                  <p className="text-small text-night-200">
                    Result: <b className="text-chalk">{cur}</b> · flagged by {who}
                    {m.dispute?.reason ? `: “${m.dispute.reason}”` : ''}
                  </p>
                  <button type="button" className="btn-primary min-h-[2.75rem] text-body" onClick={() => void act({ action: 'confirm_result', marketId: m.id })}>
                    <Icon name="check" className="h-5 w-5" /> Keep {cur}
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    {m.outcomes
                      .filter((o) => o.id !== m.outcome)
                      .map((o) => (
                        <ConfirmButton
                          key={o.id}
                          label={`Change to ${o.label}`}
                          confirmLabel={`Confirm ${o.label}`}
                          onConfirm={() => void act({ action: 'resolve', marketId: m.id, outcome: o.id }, `Changed to ${o.label}`)}
                        />
                      ))}
                    <ConfirmButton
                      label="Void"
                      confirmLabel="Tap again to void"
                      onConfirm={() => void act({ action: 'void', marketId: m.id, reason: 'disputed' })}
                    />
                  </div>
                </div>
              );
            })}
          </Section>
        )}

        {(dr.length > 0 || !cfg.autoApprove) && (
          <Section title={`AI questions waiting (${dr.length})`}>
            {dr.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-tile bg-night-850 p-2 pl-3">
                <span className="min-w-0 flex-1 text-body font-semibold">{m.question}</span>
                <button type="button" className="btn-primary min-h-[2.75rem] px-3 text-body" onClick={() => void act({ action: 'approve_draft', marketId: m.id })}>
                  Open
                </button>
                <button
                  type="button"
                  className="btn-quiet min-h-[2.75rem] px-3"
                  onClick={() => void act({ action: 'discard_draft', marketId: m.id })}
                  aria-label={`Discard “${m.question}”`}
                >
                  <Icon name="x" className="h-5 w-5" />
                </button>
              </div>
            ))}
            {dr.length === 0 && <p className="text-body text-night-400">No drafts right now.</p>}
          </Section>
        )}

        <Section title={`Markets (${active.length})`}>
          {active.length === 0 && <p className="text-body text-night-400">Nothing open. The AI opens the next one on a big moment.</p>}
          {active.map((m) => (
            <MarketRow key={m.id} m={m} />
          ))}
        </Section>

        <ReplayControls />

        <Section title="Party">
          <p className="text-small text-night-400">Default mode for new questions</p>
          <Segmented
            label="Default mode for new questions"
            options={MODES.map((x) => ({ value: x, label: MODE_LABEL[x] }))}
            value={cfg.defaultMode}
            onChange={(mode) => void act({ action: 'set_mode', mode }, `New questions: ${MODE_LABEL[mode]}`)}
          />
          <Toggle
            on={cfg.autoApprove}
            onChange={(value) => void act({ action: 'set_auto_approve', value }, value ? 'AI questions open automatically' : 'AI questions wait for you')}
            label="Open AI questions automatically"
          />
          <p className="text-small text-night-400">Announcer</p>
          <Segmented
            label="Announcer voice"
            options={PERSONAS}
            value={cfg.persona}
            onChange={(persona) => void act({ action: 'set_persona', persona }, `Announcer: ${persona}`)}
          />
        </Section>

        <CustomMarket />

        <Section title="Finish">
          <ConfirmButton label="End party" confirmLabel="Tap again: settle everything" onConfirm={() => void act({ action: 'end_party' })} />
        </Section>
      </div>
    </aside>
  );
}
