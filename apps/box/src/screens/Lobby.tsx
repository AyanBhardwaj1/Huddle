import { Aurora, Avatar, Burst, Kinetic, Roll } from '@huddle/ui';
import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { useRef, type CSSProperties } from 'react';
import { BoxButtons } from '../components/controls';
import { Icon, Wordmark } from '../components/ui';
import { leaderboard, MODE_LABEL, moneyShort } from '../lib/derive';
import { useParty } from '../party';

const SPRING = { type: 'spring', stiffness: 520, damping: 38 } as const;

export function Lobby() {
  const { view, act } = useParty();
  const s = view.snapshot!;
  const party = s.party;
  const players = leaderboard(s.players).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  const pot = players.reduce((a, p) => a + p.deposited, 0);
  // Players already here on first paint do not replay their arrival.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(players.map((p) => p.pubkey));
  const fresh = players.filter((p) => !seen.current!.has(p.pubkey));
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
    <div className="relative flex h-full bg-canvas">
      <Aurora
        blobs={[
          { c: 'rgba(255,46,147,0.14)', x: '30vw', y: '-20vmax', s: '60vmax', mx: '-6vmax', my: '8vmax', dur: '28s' },
          { c: 'rgba(255,176,32,0.16)', x: '60vw', y: '40vh', s: '50vmax', mx: '-8vmax', my: '-5vmax', dur: '32s', d: '-8s' },
        ]}
      />
      {/* Join: the one loud panel on the screen. */}
      <section
        className="hd-slide-l relative z-10 m-3 mr-0 flex w-[23rem] shrink-0 flex-col items-center justify-center gap-4 overflow-hidden rounded-blob bg-prime px-7 text-white shadow-zap"
        aria-label="Join this party"
      >
        <span className="hd-pop hd-float rounded-panel bg-white p-3.5 shadow-pop" style={{ ['--d' as string]: '160ms' }}>
          <QRCodeSVG
            value={party.joinUrl}
            size={512}
            level="M"
            style={{ width: '13.5rem', height: '13.5rem', display: 'block' }}
            bgColor="#FFFFFF"
            fgColor="#14123A"
            title={`Join at ${party.joinUrl}`}
          />
        </span>
        <p className="flex flex-col items-center gap-1 text-center font-head text-title font-extrabold leading-tight">
          <Icon name="nfc" className="h-7 w-7 shrink-0" /> Tap your phone here to join
        </p>
        <p className="text-body text-white/90">or scan, or open {joinHost}</p>
        <div className="mt-1 flex flex-col items-center gap-1.5">
          <span className="text-small font-semibold text-white/90">Party code</span>
          {/* Inline tiles (not flex items) so the element's innerText stays exactly the code. */}
          <span className="block whitespace-nowrap" data-testid="party-code" translate="no">
            {party.code.split('').map((ch, i) => (
              <span
                key={i}
                className="hd-pop mx-[0.2rem] inline-flex h-[3.75rem] w-[3rem] items-center justify-center rounded-tile bg-white font-head text-[2.5rem] font-extrabold leading-none text-ink shadow-press"
                style={{ ['--d' as string]: `${320 + i * 90}ms` }}
              >
                {ch}
              </span>
            ))}
          </span>
        </div>
      </section>

      {/* Room */}
      <section className="relative z-10 flex min-w-0 flex-1 flex-col px-7 pb-5 pt-5">
        <div className="flex items-center gap-3">
          <Wordmark className="text-title" lit={Math.max(1, Math.min(12, players.length))} />
          <span className="ml-auto">
            <BoxButtons canLock={false} showLock={false} />
          </span>
        </div>
        <h1 className="q mt-4 line-clamp-2 text-display leading-[0.95]">
          <Kinetic text={party.game.title} delay={120} />
        </h1>
        <p className="hd-rise mt-2 text-lead text-ink-2" style={{ ['--d' as string]: '360ms' }}>
          {meta.join(' · ')}
        </p>

        <div className="mt-5 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
          <p className="hd-rise card relative flex flex-col overflow-hidden px-5 py-3" style={{ ['--d' as string]: '420ms' }}>
            <span className="flex items-center gap-2 text-body font-semibold text-ink-2">
              <span className="h-3.5 w-3.5 rounded-full bg-gold shadow-gold" aria-hidden="true" /> In the pot
            </span>
            <span className="num text-hero leading-[0.88] text-ink">
              <Roll text={moneyShort(pot, party)} value={pot} arrow duration={900} />
            </span>
            {fresh.length > 0 && <Burst key={fresh.length} seed={fresh.length} count={14} spread={7} x="70%" y="55%" colours={['#FFB020', '#FFC83D', '#6C2BFF', '#FF2E93']} />}
          </p>
          <p className="hd-rise card flex flex-col px-5 py-3" style={{ ['--d' as string]: '500ms' }}>
            <span className="text-body font-semibold text-ink-2">{players.length === 1 ? 'Player' : 'Players'}</span>
            <span className="num text-hero leading-[0.88] text-zap">
              <Roll text={String(players.length)} value={players.length} duration={700} />
            </span>
          </p>
        </div>

        <ul
          className="mt-3 grid min-h-0 flex-1 content-start gap-2 overflow-hidden"
          style={{ gridTemplateColumns: `repeat(${players.length > 6 ? 3 : 2}, minmax(0, 1fr))` }}
          aria-label="Players in the room"
          aria-live="polite"
        >
          {players.map((p, i) => {
            const isFresh = !seen.current!.has(p.pubkey);
            return (
              <motion.li
                key={p.pubkey}
                layout="position"
                transition={SPRING}
                data-testid="lobby-player"
                data-player-name={p.name}
                className={`relative flex min-h-[3.25rem] items-center gap-3 rounded-tile bg-card px-2.5 shadow-lift ${isFresh ? 'hd-pop ring-2 ring-inset ring-zap' : 'hd-rise'}`}
                style={{ ['--d' as string]: isFresh ? '0ms' : `${560 + i * 60}ms` } as CSSProperties}
              >
                <Avatar name={p.name} size="2.25rem" />
                <span className="min-w-0 flex-1 truncate font-head text-title font-bold leading-none">{p.name}</span>
                {p.remote && <Icon name="globe" className="h-5 w-5 shrink-0 text-ink-muted" title="Joining remotely" />}
                <span className="num shrink-0 text-title text-ink-2">{moneyShort(p.deposited, party)}</span>
                {isFresh && p.deposited > 0 && (
                  <span
                    className="hd-coin right-6 top-1/2"
                    style={{ ['--dx' as string]: '-5rem', ['--dy' as string]: '-8rem', ['--d' as string]: '260ms' } as CSSProperties}
                    aria-hidden="true"
                  />
                )}
              </motion.li>
            );
          })}
          {players.length === 0 && (
            <li className="hd-rise col-span-full flex items-center gap-3 rounded-tile border-2 border-dashed border-rule-strong px-4 py-4 text-lead text-ink-2" style={{ ['--d' as string]: '560ms' }}>
              <span className="hd-breathe h-3 w-3 shrink-0 rounded-full bg-zap" aria-hidden="true" />
              Waiting for the first player. Phones join by tapping the box or scanning the code.
            </li>
          )}
        </ul>

        <div className="mt-3 flex items-center gap-5">
          <p className="min-w-0 flex-1 text-body text-ink-2">Start when the room is in. Friends can still join after kick-off.</p>
          <button
            type="button"
            className="btn-prime min-h-[4.25rem] rounded-panel px-10 text-title"
            onClick={() => void act({ action: 'start_game' }, 'Kick-off')}
            data-testid="start-game"
          >
            Start game <Icon name="play" className="h-6 w-6" strokeWidth={2.6} />
          </button>
        </div>
      </section>
    </div>
  );
}
