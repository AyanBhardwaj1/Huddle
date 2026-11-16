import { AnimatePresence, motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { BoxButtons } from '../components/controls';
import { Icon, Wordmark } from '../components/ui';
import { leaderboard, MODE_LABEL, moneyShort } from '../lib/derive';
import { useParty } from '../party';

export function Lobby() {
  const { view, act } = useParty();
  const s = view.snapshot!;
  const party = s.party;
  const players = leaderboard(s.players).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  const pot = players.reduce((a, p) => a + p.deposited, 0);
  const joinHost = (() => {
    try {
      const u = new URL(party.joinUrl);
      return `${u.host}${u.pathname}`;
    } catch {
      return party.joinUrl;
    }
  })();

  return (
    <div className="flex h-full gap-5 p-5">
      {/* Join */}
      <section className="flex w-[25rem] shrink-0 flex-col items-center justify-center gap-3 rounded-card bg-pitch-900 p-5 ring-1 ring-pitch-700">
        <div className="rounded-2xl bg-white p-3 shadow-glow">
          <QRCodeSVG value={party.joinUrl} size={512} level="M" style={{ width: '17rem', height: '17rem' }} bgColor="#FFFFFF" fgColor="#07090D" />
        </div>
        <div className="flex items-center gap-2 font-display text-[1.7rem] font-bold uppercase leading-none tracking-wide text-volt">
          <Icon name="nfc" className="h-7 w-7" /> Tap your phone here to join
        </div>
        <div className="text-[0.9rem] text-pitch-400">or scan · {joinHost}</div>
        <div className="mt-1 flex items-baseline gap-3">
          <span className="kicker">Party code</span>
          <span className="tabular font-display text-[3.4rem] font-bold leading-none tracking-[0.2em]">{party.code}</span>
        </div>
      </section>

      {/* Room */}
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Wordmark className="text-[1.6rem] text-pitch-200" />
            <h1 className="truncate font-display text-[3rem] font-bold uppercase leading-[0.95]">{party.game.title}</h1>
            <div className="mt-1 flex flex-wrap gap-2 text-[0.9rem] text-pitch-200">
              <span className="rounded-full bg-pitch-800 px-3 py-0.5 ring-1 ring-pitch-700">{MODE_LABEL[party.config.defaultMode]} mode</span>
              <span className="rounded-full bg-pitch-800 px-3 py-0.5 ring-1 ring-pitch-700">Buy-in {moneyShort(party.config.buyIn, party)}</span>
              {party.game.status === 'replay' && <span className="rounded-full bg-pitch-800 px-3 py-0.5 ring-1 ring-pitch-700">Replay</span>}
              {party.config.settlement === 'points' && <span className="rounded-full bg-pitch-800 px-3 py-0.5 ring-1 ring-pitch-700">Points only</span>}
            </div>
          </div>
          <BoxButtons canLock={false} />
        </div>

        <div className="flex items-baseline gap-4">
          <span className="font-display text-[4.2rem] font-bold leading-none text-volt tabular">{players.length}</span>
          <span className="font-display text-[1.6rem] font-semibold uppercase tracking-wide text-pitch-200">{players.length === 1 ? 'player in' : 'players in'}</span>
          <span className="ml-auto font-display text-[1.6rem] font-semibold uppercase text-pitch-400">
            Pot <span className="tabular text-pitch-50">{moneyShort(pot, party)}</span>
          </span>
        </div>

        <div className="grid min-h-0 flex-1 auto-rows-[4.2rem] grid-cols-2 content-start gap-2.5 overflow-hidden">
          <AnimatePresence>
            {players.map((p) => (
              <motion.div
                key={p.pubkey}
                layout
                initial={{ scale: 0.3, opacity: 0, rotate: -4 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 18 }}
                className="join-flash flex items-center gap-3 rounded-xl bg-pitch-800 px-3 ring-1 ring-pitch-600"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-volt font-display text-[1.6rem] font-bold uppercase text-volt-ink">
                  {p.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1 truncate font-display text-[1.8rem] font-semibold leading-none">{p.name}</span>
                {p.remote && <Icon name="remote" className="h-5 w-5 text-pitch-400" aria-label="Remote player" />}
                <span className="tabular font-display text-[1.4rem] font-semibold text-up">{moneyShort(p.deposited, party)}</span>
              </motion.div>
            ))}
          </AnimatePresence>
          {players.length === 0 && (
            <div className="col-span-2 flex h-full items-center justify-center rounded-xl border-2 border-dashed border-pitch-700 text-[1.3rem] text-pitch-400">
              Waiting for the first player…
            </div>
          )}
        </div>

        <button className="btn-volt min-h-[4.6rem] text-[2.3rem]" onClick={() => void act({ action: 'start_game' }, 'Kick off!')}>
          Start game <Icon name="play" className="h-8 w-8" />
        </button>
      </section>
    </div>
  );
}
