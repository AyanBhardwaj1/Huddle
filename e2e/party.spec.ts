import { runBots } from '@huddle/engine/bots';
import { HuddleClient, wsUrlFor, type Market } from '@huddle/shared';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { E2E_SPEED, USDC } from './support/constants';
import { getParty, startEngineProcess, type EngineProcess } from './support/engine';

/**
 * The core loop in real pages: the box UI creates a party, two phones join by link and buy in, the
 * host starts the replay, the phones bet on opposite sides of the same market, the game runs to the
 * end and the party is paid out (points settlement). Then all three modes again with bot players.
 *
 * Selectors: only the data-testid hooks listed in e2e/README.md (the UI is being redesigned; copy,
 * layout and classes may change). No sleeps: every wait is on page state, REST or the observer.
 */

const GAME = 'replay-por-esp';
/** A binary full-game market that opens at kickoff and stays open until the 80th minute. */
const MARKET_TEMPLATE_Q = /Will Portugal score \d\+ goals\?/;

let engine: EngineProcess;

test.beforeAll(async () => {
  engine = await startEngineProcess(E2E_SPEED);
});

test.afterAll(async () => {
  await engine?.stop();
});

// eslint-disable-next-line no-empty-pattern -- Playwright needs the fixtures argument to reach testInfo
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) console.log(`engine log tail:\n${engine.logs.slice(-40).join('\n')}`);
});

const status = (page: Page) => page.getByTestId('party-status');

async function hostCreatesParty(browser: Browser, mode: 'pool' | 'amm' | 'bet'): Promise<{ ctx: BrowserContext; box: Page; code: string; hostToken: string }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 750 } });
  const box = await ctx.newPage();
  await box.goto(`${engine.url}/box/`);
  const start = box.getByTestId('start-party');
  await expect(start).toBeEnabled();
  await start.click();
  await box.locator(`[data-testid="game-option"][data-game-id="${GAME}"]`).click();
  await box.getByTestId(`mode-${mode}`).click();
  await box.getByTestId('settlement-points').click();
  await box.getByTestId('create-party').click();
  await expect(status(box)).toHaveAttribute('data-status', 'lobby');
  const code = (await box.getByTestId('party-code').innerText()).trim();
  expect(code).toMatch(/^[A-Z]{4}$/);
  // The kiosk keeps its session (code + host token) in localStorage; the host token authorizes REST control.
  const session = await box.evaluate(() => JSON.parse(localStorage.getItem('huddle.box.session') ?? 'null') as { partyCode: string; hostToken: string } | null);
  expect(session?.partyCode).toBe(code);
  return { ctx, box, code, hostToken: session!.hostToken };
}

async function playerJoins(browser: Browser, code: string, name: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${engine.url}/j/${code}`);
  await page.getByTestId('join-name').fill(name);
  await page.getByTestId('join-submit').click();
  await page.getByTestId('buy-in').click();
  await expect(page.getByTestId('buy-in-done')).toBeVisible();
  // The confirmation moves on to the party screen by itself.
  await expect(status(page)).toHaveAttribute('data-status', /lobby|live/);
  return { ctx, page };
}

async function bet(page: Page, marketId: string, outcome: string): Promise<void> {
  await page.bringToFront();
  const card = page.locator(`[data-testid="market-card"][data-market-id="${marketId}"]`);
  const pick = card.getByTestId(`outcome-${outcome}`);
  await expect(pick).toBeEnabled();
  await pick.click();
  await card.getByTestId('stake-chip').first().click();
  // The chips close once the bet is accepted.
  await expect(card.getByTestId('stake-chip')).toHaveCount(0);
}

function observe(code: string, hostToken: string): HuddleClient {
  const c = new HuddleClient({ url: wsUrlFor(engine.url), partyCode: code, role: 'box', hostToken });
  c.connect();
  return c;
}

async function waitFor(pred: () => boolean, what: string, timeoutMs = 150_000): Promise<void> {
  await expect.poll(pred, { message: what, timeout: timeoutMs, intervals: [100, 250, 500] }).toBe(true);
}

for (const mode of ['pool', 'amm'] as const) {
  test(`${mode} mode in the browser: create, join, buy in, bet, resolve, pay out`, async ({ browser }) => {
    const { ctx: boxCtx, box, code, hostToken } = await hostCreatesParty(browser, mode);
    const observer = observe(code, hostToken);
    await observer.ready();
    expect(observer.getView().snapshot?.party.config.defaultMode).toBe(mode);

    // Compress the replay to match the engine's time scale.
    const speed = await fetch(`${engine.url}/replays/${GAME}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-host-token': hostToken },
      body: JSON.stringify({ partyCode: code, action: 'speed', speed: E2E_SPEED }),
    });
    expect(speed.status).toBe(200);

    const ayan = await playerJoins(browser, code, 'Ayan');
    const priya = await playerJoins(browser, code, 'Priya');
    await expect(box.locator('[data-testid="lobby-player"][data-player-name="Ayan"]')).toBeVisible();
    await expect(box.locator('[data-testid="lobby-player"][data-player-name="Priya"]')).toBeVisible();
    const lobby = await getParty(engine.url, code);
    expect(lobby.players.filter((p) => !p.isHouse).map((p) => [p.name, p.deposited]).sort()).toEqual([['Ayan', 10 * USDC], ['Priya', 10 * USDC]]);

    await box.bringToFront();
    const gate = box.getByTestId('sound-gate');
    if (await gate.isVisible()) await gate.click();
    await box.getByTestId('start-game').click();
    await expect(status(box)).toHaveAttribute('data-status', 'live');

    // The question engine opens the market at kickoff; find its id from the host's view.
    let market: Market | undefined;
    await waitFor(() => !!(market = observer.getView().snapshot?.markets.find((m) => MARKET_TEMPLATE_Q.test(m.question) && m.state === 'open')), 'market open', 30_000);
    expect(market!.mode).toBe(mode);
    await bet(ayan.page, market!.id, 'yes');
    await bet(priya.page, market!.id, 'no');
    const before = await getParty(engine.url, code);
    for (const n of ['Ayan', 'Priya']) expect(before.players.find((p) => p.name === n)!.balance).toBeLessThan(10 * USDC);

    // The game runs to the end and the party is paid out.
    await waitFor(() => observer.getView().snapshot?.party.status === 'finalized', 'party finalized');
    const final = await getParty(engine.url, code);
    expect(final.party.status).toBe('finalized');

    // The market both phones bet on resolved, and money moved from the loser to the winner.
    const settled = observer.getView().snapshot!.markets.find((m) => m.id === market!.id)!;
    expect(['resolved', 'final']).toContain(settled.state);
    expect(settled.outcome).toMatch(/^(yes|no)$/);
    const by = (n: string) => final.players.find((p) => p.name === n)!;
    const winner = settled.outcome === 'yes' ? 'Ayan' : 'Priya';
    const loser = winner === 'Ayan' ? 'Priya' : 'Ayan';
    expect(by(winner).payout).toBeGreaterThan(by(loser).payout!);
    expect(by(loser).payout).toBeLessThan(10 * USDC);

    // Points settlement: payouts (players + house) sum exactly to deposits.
    const deposits = final.players.reduce((a, p) => a + p.deposited, 0);
    const payouts = final.players.reduce((a, p) => a + (p.payout ?? 0), 0);
    expect(payouts).toBe(deposits);

    // Each phone shows its own payout; the box reaches the end of the game.
    for (const [name, page] of [['Ayan', ayan.page], ['Priya', priya.page]] as const) {
      await page.bringToFront();
      await expect(status(page)).toHaveAttribute('data-status', 'finalized');
      await expect(page.getByTestId('my-payout')).toHaveAttribute('data-amount', String(by(name).payout));
      await expect(page.getByTestId('final-leaderboard')).toBeVisible();
    }
    await box.bringToFront();
    await expect(status(box)).toHaveAttribute('data-status', 'finalized');

    observer.close();
    await Promise.all([boxCtx.close(), ayan.ctx.close(), priya.ctx.close()]);
  });
}

test('pool, market and bet modes with bot players (HuddleClient) on the same engine', async () => {
  const modes = ['pool', 'amm', 'bet'] as const;
  const runs = await Promise.all(
    modes.map(async (mode) => {
      const res = await fetch(`${engine.url}/parties`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: `e2e ${mode}`, gameId: GAME, defaultMode: mode, buyIn: 10, settlement: 'points' }),
      });
      expect(res.status).toBe(200);
      const { party, hostToken } = (await res.json()) as { party: { code: string }; hostToken: string };
      const bots = await runBots({ url: engine.url, partyCode: party.code, n: 3, intervalMs: 250, seed: 7 });
      const host = { 'content-type': 'application/json', 'x-host-token': hostToken };
      for (const body of [{ action: 'speed', speed: E2E_SPEED }, { action: 'start' }]) {
        const r = await fetch(`${engine.url}/replays/${GAME}/start`, { method: 'POST', headers: host, body: JSON.stringify({ partyCode: party.code, ...body }) });
        expect(r.status).toBe(200);
      }
      return { mode, code: party.code, bots };
    }),
  );

  await Promise.all(runs.map((r) => r.bots.done));
  for (const { mode, code, bots } of runs) {
    const final = await getParty(engine.url, code);
    expect(final.party.status, mode).toBe('finalized');
    const deposits = final.players.reduce((a, p) => a + p.deposited, 0);
    const payouts = final.players.reduce((a, p) => a + (p.payout ?? 0), 0);
    expect(payouts, `${mode}: payouts sum to deposits`).toBe(deposits);
    const markets = bots.bots[0]!.client.getView().snapshot!.markets;
    expect(markets.filter((m) => m.state === 'final' || m.state === 'resolved').length, `${mode}: resolved markets`).toBeGreaterThan(3);
    // When the house budget runs low, later AMM markets fall back to pool (A2-8).
    expect(markets.some((m) => m.mode === mode), `${mode}: markets in the party's mode`).toBe(true);
    expect(bots.stats.accepted, `${mode}: bots traded`).toBeGreaterThan(5);
    const kinds = Object.keys(bots.stats.byKind);
    if (mode === 'amm') expect(kinds.some((k) => k.startsWith('amm_'))).toBe(true);
    if (mode === 'bet') expect(kinds.some((k) => k === 'post_offer' || k === 'take_offer' || k === 'bet_one_tap')).toBe(true);
    const botPayouts = final.players.filter((p) => !p.isHouse).map((p) => p.payout ?? 0);
    expect(botPayouts.some((p) => p !== 10 * USDC), `${mode}: balances changed`).toBe(true);
    bots.close();
  }
});
