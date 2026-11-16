import { USDC } from '@huddle/shared';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FixtureClient } from '../fixture';
import { PartyShell } from './Party';

/** Smoke test: every fixture variant renders the expected screen without throwing (no DOM, no engine). */
function render(variant: string): string {
  const client = new FixtureClient(variant);
  return renderToString(<PartyShell client={client} view={client.getView()} remote={false} />);
}

describe('player screens (fixture)', () => {
  it('renders the live screen with all three modes, positions, offers and a draft', () => {
    const html = render('live');
    expect(html).toContain('Will Ronaldo score this penalty?'); // pool moment
    expect(html).toContain('Who wins the match?'); // amm game market
    expect(html).toContain('Corner leads to a shot on target?'); // head-to-head
    expect(html).toContain('Cash out now');
    expect(html).toContain('Friends vs. the Pros');
    expect(html).toContain('Take it'); // a friend's offer
    expect(html).toContain('Your offer');
    expect(html).toContain('Offer your own odds');
    expect(html).toContain('Flag it'); // dispute window on the resolved market
    expect(html).toContain('Voided');
    expect(html).toContain('The announcer drafted a bet for you');
    expect(html).toContain('Right now');
    expect(html).toContain('All game');
    expect(html).not.toMatch(/wallet|transaction|sign /i);
  });

  it('renders the buy-in screen for a player who has not bought in', () => {
    const html = render('buyin');
    expect(html).toContain('Buy in $10');
    expect(html).toContain('Just watch for now');
  });

  it('renders the end of game with payout and explorer link', () => {
    const html = render('end');
    expect(html).toContain('Full time');
    expect(html).toContain('Your winnings are in');
    expect(html).toContain('View payout');
    expect(html).toContain('Settled on Solana');
    expect(html).toContain('Final leaderboard');
  });

  it('shows points instead of dollars in points mode', () => {
    const client = new FixtureClient('buyin');
    const snap = client.getView().snapshot!;
    snap.party.config.settlement = 'points';
    const html = renderToString(<PartyShell client={client} view={client.getView()} remote={false} />);
    expect(html).toContain(`Buy in ${10 * USDC / USDC} pts`);
    expect(html).not.toContain('$');
  });
});
