import { Roll } from '@huddle/ui';
import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { useRef, type CSSProperties } from 'react';
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
  // Players already here on first paint do not replay their arrival.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(players.map((p) => p.pubkey));
  const joinHost = (() => {
    try {
      const u = new URL(party.joinUrl);
      return `${u.host}${u.pathname}`;
    } catch {
      return party.joinUrl;
    }
  })();
  const meta = [
    `${MODE_LABEL[party.config.defaultMode]} mode`,
    `${moneyShort(party.config.buyIn, party)} buy-in`,
    party.game.status === 'replay' ? 'Replay' : null,
    party.config.settlement === 'points' ? 'Points only, no money' : party.config.settlement === 'vault' ? 'Test money, paid out automatically' : 'Host pays out',
  ].filter(Boolean);

  return (
    <div className="flex h-full">
      {/* Join */}
      <section className="flex w-[24rem] shrink-0 flex-col items-center justify-center gap-4 bg-night-900 px-8" aria-label="Join this party">
        <span className="rounded-panel bg-chalk p-4">
          <QRCodeSVG
            value={party.joinUrl}
            size={512}
            level="M"
            style={{ width: '14.5rem', height: '14.5rem', display: 'block' }}
            bgColor="#F4F2EC"
            fgColor="#08090B"
            title={`Join at ${party.joinUrl}`}
          />
        </span>
        <p className="flex flex-col items-center gap-1 text-center text-title font-bold leading-tight text-flood">
          <Icon name="nfc" className="h-7 w-7 shrink-0" /> Tap your phone here to join
        </p>
        <p className="text-body text-night-400">or scan, or open {joinHost}</p>
        <p className="mt-1 flex flex-col items-center">
          <span className="text-small text-night-400">Party code</span>
          <span className="font-display text-[3.5rem] font-black leading-none tracking-[0.14em]" style={{ fontStretch: '125%' }} data-testid="party-code" translate="no">
            {party.code}
          </span>
        </p>
      </section>

      {/* Room */}
      <section className="flex min-w-0 flex-1 flex-col px-8 pb-6 pt-5">
        <div className="flex items-center gap-3">
          <Wordmark className="text-title text-night-400" lit={Math.max(1, Math.min(12, players.length))} />
          <span className="ml-auto">
            <BoxButtons canLock={false} showLock={false} />
          </span>
        </div>
        <h1 className="q mt-5 line-clamp-2 text-display leading-[0.95]">{party.game.title}</h1>
        <p className="mt-2 text-lead text-night-200">{meta.join(' · ')}</p>

        <div className="mt-6 flex items-end gap-10 border-b border-night-700 pb-4">
          <p className="flex flex-col">
            <span className="text-body text-night-400">In the pot</span>
            <span className="num text-hero leading-[0.85]">
              <Roll text={moneyShort(pot, party)} value={pot} arrow />
            </span>
          </p>
          <p className="flex flex-col">
            <span className="text-body text-night-400">{players.length === 1 ? 'Player' : 'Players'}</span>
            <span className="num text-hero leading-[0.85] text-night-200">
              <Roll text={String(players.length)} value={players.length} />
            </span>
          </p>
        </div>

        <ul
          className="mt-4 grid min-h-0 flex-1 content-start gap-x-6 gap-y-1 overflow-hidden"
          style={{ gridTemplateColumns: `repeat(${players.length > 6 ? 3 : 2}, minmax(0, 1fr))` }}
          aria-label="Players in the room"
          aria-live="polite"
        >
          {players.map((p) => {
            const fresh = !seen.current!.has(p.pubkey);
            return (
              <motion.li
                key={p.pubkey}
                layout="position"
                transition={{ type: 'spring', stiffness: 520, damping: 42 }}
                data-testid="lobby-player"
                data-player-name={p.name}
                className={`relative flex min-h-[3.25rem] items-center gap-3 rounded-tile px-2 ${fresh ? 'hd-pop join-flash' : ''}`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-tile bg-night-800 font-display text-title font-extrabold text-flood" aria-hidden="true">
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-title font-bold">{p.name}</span>
                {p.remote && <Icon name="globe" className="h-5 w-5 shrink-0 text-night-400" title="Joining remotely" />}
                <span className="num shrink-0 text-title text-night-200">{moneyShort(p.deposited, party)}</span>
                {fresh && p.deposited > 0 && (
                  <span
                    className="hd-coin right-6 top-1/2"
                    style={{ ['--dx' as string]: '-4rem', ['--dy' as string]: '-7rem', ['--d' as string]: '200ms' } as CSSProperties}
                    aria-hidden="true"
                  />
                )}
              </motion.li>
            );
          })}
          {players.length === 0 && (
            <li className="col-span-full flex items-center gap-3 py-3 text-lead text-night-400">
              <span className="hd-breathe h-2.5 w-2.5 rounded-full bg-flood" aria-hidden="true" />
              Waiting for the first player. Phones join by tapping the box or scanning the code.
            </li>
          )}
        </ul>

        <div className="mt-4 flex items-center gap-5">
          <p className="min-w-0 flex-1 text-body text-night-400">Start when the room is in. Friends can still join after kick-off.</p>
          <button type="button" className="btn-primary min-h-[4rem] px-10 text-title" onClick={() => void act({ action: 'start_game' }, 'Kick-off')} data-testid="start-game">
            Start game <Icon name="play" className="h-6 w-6" strokeWidth={2.6} />
          </button>
        </div>
      </section>
    </div>
  );
}
