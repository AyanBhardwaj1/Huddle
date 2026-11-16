import type { Market, MarketMode, Persona } from '@huddle/shared';
import { motion } from 'framer-motion';
import { useState, type ReactNode } from 'react';
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

function Section({ title, children, accent }: { title: string; children: ReactNode; accent?: boolean }) {
  return (
    <section className={`rounded-xl p-3 ring-1 ${accent ? 'bg-down/10 ring-down/60' : 'bg-pitch-900 ring-pitch-700'}`}>
      <h3 className={`kicker mb-2 text-[0.85rem] ${accent ? 'text-down' : ''}`}>{title}</h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

/** Two-tap confirm for destructive actions. */
function ConfirmButton({ label, confirmLabel, onConfirm, className = 'btn-ghost' }: { label: ReactNode; confirmLabel: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      className={`${armed ? 'btn-down' : className} text-[1.05rem]`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          setTimeout(() => setArmed(false), 3000);
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
    <div className="rounded-lg bg-pitch-800 p-2 ring-1 ring-pitch-700">
      <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((x) => !x)}>
        <span className={`rounded px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-widest ${m.state === 'open' ? 'bg-volt text-volt-ink' : 'bg-pitch-600 text-pitch-50'}`}>
          {m.state}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.95rem] font-semibold">{m.question}</span>
        <span className="tabular text-[0.8rem] text-pitch-400">{moneyShort(m.volume, party)}</span>
        <Icon name={open ? 'up' : 'down'} className="h-3 w-3 text-pitch-400" />
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {m.state === 'open' && (
            <button className="btn-volt text-[1.05rem]" onClick={() => void act({ action: 'lock', marketId: m.id })}>
              <Icon name="lock" className="h-5 w-5" /> Lock now
            </button>
          )}
          <div className="text-[0.75rem] font-bold uppercase tracking-widest text-pitch-400">Resolve as</div>
          <div className="grid grid-cols-2 gap-2">
            {m.outcomes.map((o) => (
              <ConfirmButton
                key={o.id}
                label={`${o.label} · ${Math.round(roomProb(m, o.id) * 100)}%`}
                confirmLabel={`Confirm: ${o.label}`}
                onConfirm={() => void act({ action: 'resolve', marketId: m.id, outcome: o.id })}
              />
            ))}
          </div>
          <ConfirmButton label="Void (refund all)" confirmLabel="Tap again to void" onConfirm={() => void act({ action: 'void', marketId: m.id, reason: 'host' })} />
          {canSwitch && (
            <>
              <div className="text-[0.75rem] font-bold uppercase tracking-widest text-pitch-400">Mode for this question</div>
              <Segmented
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
  const { act } = useParty();
  const [q, setQ] = useState('');
  const [outcomes, setOutcomes] = useState(['Yes', 'No']);
  const [secs, setSecs] = useState(45);
  const valid = q.trim().length >= 3 && outcomes.filter((o) => o.trim()).length >= 2;
  const presets = ['Goal in the next 5 minutes?', 'Will the next shot be on target?', 'Another card before half time?'];
  return (
    <Section title="Ask your own question">
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button key={p} onClick={() => setQ(p)} className="rounded-full bg-pitch-800 px-3 py-1 text-[0.8rem] ring-1 ring-pitch-700">
            {p}
          </button>
        ))}
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value.slice(0, 140))}
        placeholder="Type a question…"
        className="min-h-[3rem] rounded-lg bg-pitch-800 px-3 text-[1.05rem] outline-none ring-1 ring-pitch-600 focus:ring-volt"
      />
      <div className="flex flex-wrap gap-2">
        {outcomes.map((o, i) => (
          <div key={i} className="flex items-center rounded-lg bg-pitch-800 ring-1 ring-pitch-600">
            <input
              value={o}
              onChange={(e) => setOutcomes(outcomes.map((x, j) => (j === i ? e.target.value.slice(0, 40) : x)))}
              className="h-10 w-[7rem] bg-transparent px-2 text-[0.95rem] outline-none"
              aria-label={`Outcome ${i + 1}`}
            />
            {outcomes.length > 2 && (
              <button className="px-2 text-pitch-400" onClick={() => setOutcomes(outcomes.filter((_, j) => j !== i))} aria-label="Remove outcome">
                <Icon name="x" className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {outcomes.length < 6 && (
          <button className="flex h-10 items-center gap-1 rounded-lg px-3 text-[0.9rem] ring-1 ring-pitch-600" onClick={() => setOutcomes([...outcomes, `Option ${outcomes.length + 1}`])}>
            <Icon name="plus" className="h-4 w-4" /> Outcome
          </button>
        )}
      </div>
      <Segmented options={LOCK_SECS.map((s) => ({ value: s, label: s < 60 ? `${s}s` : `${s / 60}m` }))} value={secs} onChange={setSecs} />
      <button
        className="btn-volt"
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
          className="btn-ghost w-[4rem]"
          onClick={() => void act({ action: r.playing ? 'pause_game' : 'start_game' }, r.playing ? 'Paused' : 'Playing')}
          aria-label={r.playing ? 'Pause' : 'Play'}
        >
          <Icon name={r.playing ? 'pause' : 'play'} className="h-6 w-6" />
        </button>
        <Segmented
          className="flex-1"
          options={SPEEDS.map((s) => ({ value: s, label: `${s}x` }))}
          value={SPEEDS.includes(r.speed) ? r.speed : 1}
          onChange={(speed) => void act({ action: 'set_speed', speed }, `${speed}x speed`)}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="tabular w-[3.5rem] text-[0.9rem] text-pitch-200">{fmt(pos)}</span>
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
          className="h-10 flex-1 accent-[#D4FF3A]"
          aria-label="Seek replay"
        />
        <span className="tabular w-[3.5rem] text-right text-[0.9rem] text-pitch-400">{fmt(r.durationMs)}</span>
      </div>
      <div className="text-[0.75rem] text-pitch-400">
        Event {r.seq} of {r.totalEvents}
      </div>
    </Section>
  );
}

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
    <motion.aside
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 34 }}
      className="absolute inset-y-0 right-0 z-40 flex w-[30rem] max-w-full flex-col border-l border-pitch-700 bg-pitch-950/[0.97] shadow-2xl backdrop-blur"
      aria-label="Host controls"
    >
      <div className="flex items-center gap-3 border-b border-pitch-700 px-4 py-3">
        <Icon name="cog" className="h-6 w-6 text-volt" />
        <h2 className="font-display text-[1.6rem] font-bold uppercase tracking-wide">Host controls</h2>
        <span className="kicker ml-auto text-[0.75rem]">N = next</span>
        <button className="btn-ghost min-h-[2.6rem] px-3" onClick={() => setView('board')} aria-label="Close host controls">
          <Icon name="x" className="h-5 w-5" />
        </button>
      </div>
      <div className="scroll-thin flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {current?.state === 'open' && (
          <button className="btn-volt min-h-[4rem] text-[1.8rem]" onClick={() => void act({ action: 'lock', marketId: current.id })}>
            <Icon name="lock" className="h-7 w-7" /> Lock now
          </button>
        )}

        {ds.length > 0 && (
          <Section title={`Disputed (${ds.length})`} accent>
            {ds.map((m) => {
              const who = s.players.find((p) => p.pubkey === m.dispute?.by)?.name ?? 'A player';
              const cur = m.outcomes.find((o) => o.id === m.outcome)?.label ?? m.outcome;
              return (
                <div key={m.id} className="flex flex-col gap-2 rounded-lg bg-pitch-900 p-2">
                  <div className="text-[0.95rem] font-semibold">{m.question}</div>
                  <div className="text-[0.85rem] text-pitch-200">
                    Result: <b>{cur}</b> · flagged by {who}
                    {m.dispute?.reason ? ` — “${m.dispute.reason}”` : ''}
                  </div>
                  <button className="btn-up text-[1.05rem]" onClick={() => void act({ action: 'confirm_result', marketId: m.id })}>
                    <Icon name="check" className="h-5 w-5" /> Keep {cur}
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    {m.outcomes
                      .filter((o) => o.id !== m.outcome)
                      .map((o) => (
                        <ConfirmButton key={o.id} label={`Change to ${o.label}`} confirmLabel={`Confirm ${o.label}`} onConfirm={() => void act({ action: 'resolve', marketId: m.id, outcome: o.id }, `Changed to ${o.label}`)} />
                      ))}
                    <ConfirmButton label="Void" confirmLabel="Tap again to void" onConfirm={() => void act({ action: 'void', marketId: m.id, reason: 'disputed' })} />
                  </div>
                </div>
              );
            })}
          </Section>
        )}

        {(dr.length > 0 || !cfg.autoApprove) && (
          <Section title={`AI questions waiting (${dr.length})`}>
            {dr.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-lg bg-pitch-800 p-2">
                <span className="min-w-0 flex-1 text-[0.95rem] font-semibold">{m.question}</span>
                <button className="btn-volt min-h-[2.6rem] px-3 text-[1rem]" onClick={() => void act({ action: 'approve_draft', marketId: m.id })}>
                  Open
                </button>
                <button className="btn-ghost min-h-[2.6rem] px-3 text-[1rem]" onClick={() => void act({ action: 'discard_draft', marketId: m.id })} aria-label="Discard">
                  <Icon name="x" className="h-5 w-5" />
                </button>
              </div>
            ))}
            {dr.length === 0 && <div className="text-[0.9rem] text-pitch-400">No drafts right now.</div>}
          </Section>
        )}

        <Section title={`Markets (${active.length})`}>
          {active.length === 0 && <div className="text-[0.9rem] text-pitch-400">Nothing open. The AI will open the next one on a big moment.</div>}
          {active.map((m) => (
            <MarketRow key={m.id} m={m} />
          ))}
        </Section>

        <ReplayControls />

        <Section title="Party">
          <div className="text-[0.75rem] font-bold uppercase tracking-widest text-pitch-400">Default mode for new questions</div>
          <Segmented
            options={MODES.map((x) => ({ value: x, label: MODE_LABEL[x] }))}
            value={cfg.defaultMode}
            onChange={(mode) => void act({ action: 'set_mode', mode }, `New questions: ${MODE_LABEL[mode]}`)}
          />
          <Toggle on={cfg.autoApprove} onChange={(value) => void act({ action: 'set_auto_approve', value }, value ? 'AI questions open automatically' : 'AI questions wait for you')} label="Open AI questions automatically" />
          <div className="text-[0.75rem] font-bold uppercase tracking-widest text-pitch-400">Announcer</div>
          <Segmented options={PERSONAS} value={cfg.persona} onChange={(persona) => void act({ action: 'set_persona', persona }, `Announcer: ${persona}`)} />
        </Section>

        <CustomMarket />

        <Section title="Finish">
          <ConfirmButton
            label="End party"
            confirmLabel="Tap again: settle everything"
            className="btn-ghost"
            onConfirm={() => void act({ action: 'end_party' })}
          />
        </Section>
      </div>
    </motion.aside>
  );
}
