import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PartyScreens } from './App';
import { HostPanel } from './components/HostPanel';
import { fixtureView } from './fixture';
import { StaticPartyProvider } from './party';
import { CreateParty } from './screens/CreateParty';
import { Home } from './screens/Home';
import { ScorecardPanel } from './screens/Scorecard';

/** Render smoke tests: every screen renders from the fixture without throwing and shows its key content. */
function render(kind: Parameters<typeof fixtureView>[0]): string {
  return renderToString(
    <StaticPartyProvider view={fixtureView(kind)}>
      <PartyScreens />
    </StaticPartyProvider>,
  );
}

describe('box screens render from fixtures', () => {
  it('live board: scorebug, takeover, pros row, dispute banner, captions', () => {
    const html = render('live');
    for (const s of [
      'POR',
      'ESP',
      '67&#x27;',
      'Ronaldo steps up',
      'Moment market',
      'Friends vs. the Pros',
      'Gemini',
      'Result disputed',
      'Penalty to Portugal',
      'Lock',
      'Talk',
    ]) {
      expect(html).toContain(s);
    }
  });
  it('host panel', () => {
    // zustand's server snapshot is the initial state, so render the overlays directly.
    const html = renderToString(
      <StaticPartyProvider view={fixtureView('live')}>
        <HostPanel />
      </StaticPartyProvider>,
    );
    for (const s of [
      'Host controls',
      'Lock now',
      'Disputed (1)',
      'AI questions waiting (1)',
      'Replay',
      'End party',
      'Ask your own question',
    ]) {
      expect(html).toContain(s);
    }
  });
  it('scorecard overlay', () => {
    const html = renderToString(<ScorecardPanel scorecard={fixtureView('scorecard').snapshot!.scorecard} />);
    expect(html).toContain('Who&#x27;s smarter?');
    expect(html).toContain('Brier score');
  });
  it('lobby: QR, code and players', () => {
    const html = render('lobby');
    for (const s of ['Tap your phone here to join', 'KICK', 'Priya', 'Start game', '<svg']) expect(html).toContain(s);
  });
  it('end of game: podium, verdict, settlement', () => {
    const html = render('end');
    for (const s of ['Priya', 'Challenge window', 'Payout landed', 'New party', 'receipt']) expect(html).toContain(s);
  });
  it('home and create party render without an engine', () => {
    expect(renderToString(<Home />)).toContain('Start a party');
    expect(renderToString(<CreateParty />)).toContain('Create party');
  });
});
