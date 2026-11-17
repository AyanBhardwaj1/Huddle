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
 * No sleeps: every wait is on page text, REST state or the observer's view.
 */

const GAME = 'replay-por-esp';
const GAME_TITLE = 'Portugal vs Spain';
/** A binary full-game market that opens at kickoff and stays open until the 80th minute. */
const MARKET_Q = /Will Portugal score \d\+ goals\?/;

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

const pts = (base: number): string => `${(base / USDC).toFixed(2)} pts`;

async function hostCreatesParty(browser: Browser, modeLabel: 'Pool' | 'Market' | 'Bet'): Promise<{ ctx: BrowserContext; box: Page; code: string; hostToken: string }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 750 } });
  const box = await ctx.newPage();
  await box.goto(`${engine.url}/box/`);
  const start = box.getByRole('button', { name: /Start a party/ });
  await expect(start).toBeEnabled();
  await start.click();
  await box.getByRole('button', { name: new RegExp(GAME_TITLE) }).click();
  await box.getByRole('radio', { name: new RegExp(`^${modeLabel}`) }).click();
  await box.getByRole('radio', { name: /^Points/ }).click();
  await box.getByRole('button', { name: /Create party/ }).click();
  await expect(box.getByText('Party code')).toBeVisible();
  const session = await box.evaluate(() => JSON.parse(localStorage.getItem('huddle.box.session') ?? 'null') as { partyCode: string; hostToken: string } | null);
  expect(session?.partyCode).toMatch(/^[A-Z]{4}$/);
  await expect(box.getByText(session!.partyCode, { exact: true })).toBeVisible();
  return { ctx, box, code: session!.partyCode, hostToken: session!.hostToken };
}

async function dismissSoundGate(page: Page): Promise<void> {
  const gate = page.getByRole('button', { name: /Tap to enable sound/ });
  if (await gate.isVisible()) await gate.click();
  await expect(gate).toBeHidden();
}

async function playerJoins(browser: Browser, code: string, name: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${engine.url}/j/${code}`);
  await page.locator('#name').fill(name);
  await page.getByRole('button', { name: 'Join the party' }).click();
  await page.getByRole('button', { name: /^Buy in/ }).click();
  await expect(page.getByText(`You're in, ${name}!`)).toBeVisible();
  // The confirmation moves on to the live screen by itself after about 2 s.
  await expect(page.getByRole('button', { name: "Let's go" })).toBeHidden();
  return { ctx, page };
}

async function bet(page: Page, outcome: 'Yes' | 'No'): Promise<void> {
  await page.bringToFront();
  const card = page.locator('article').filter({ hasText: MARKET_Q });
  const pick = card.getByRole('button', { name: new RegExp(`^${outcome}\\b`) });
  await expect(pick).toBeEnabled();
  await pick.click();
  // The stake chips ("2 pts / pays 3.10 pts"); the outcome buttons say "1 pays …" without "pts" first.
  const chip = card.locator('button').filter({ hasText: /pts\s*pays/ }).first();
  await chip.click();
  await expect(page.getByText(new RegExp(`on ${outcome}\\. You're in\\.`))).toBeVisible();
}

function observe(code: string, hostToken: string): HuddleClient {
  const c = new HuddleClient({ url: wsUrlFor(engine.url), partyCode: code, role: 'box', hostToken });
  c.connect();
  return c;
}

async function waitFor(pred: () => boolean, what: string, timeoutMs = 120_000): Promise<void> {
  await expect.poll(pred, { message: what, timeout: timeoutMs, intervals: [100, 250, 500] }).toBe(true);
}

for (const modeLabel of ['Pool', 'Market'] as const) {
  test(`${modeLabel} mode in the browser: create, join, buy in, bet, resolve, pay out`, async ({ browser }) => {
    const { ctx: boxCtx, box, code, hostToken } = await hostCreatesParty(browser, modeLabel);
    const observer = observe(code, hostToken);
    await observer.ready();
    expect(observer.getView().snapshot?.party.config.defaultMode).toBe(modeLabel === 'Pool' ? 'pool' : 'amm');

    // Compress the replay to match the engine's time scale.
    const speed = await fetch(`${engine.url}/replays/${GAME}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-host-token': hostToken },
      body: JSON.stringify({ partyCode: code, action: 'speed', speed: E2E_SPEED }),
    });
    expect(speed.status).toBe(200);

    const ayan = await playerJoins(browser, code, 'Ayan');
    const priya = await playerJoins(browser, code, 'Priya');
    await expect(box.getByText('Ayan')).toBeVisible();
    await expect(box.getByText('Priya')).toBeVisible();
    await expect(box.getByText('players in')).toBeVisible();
    const lobby = await getParty(engine.url, code);
    expect(lobby.players.filter((p) => !p.isHouse).map((p) => [p.name, p.deposited]).sort()).toEqual([['Ayan', 10 * USDC], ['Priya', 10 * USDC]]);

    await box.bringToFront();
    await dismissSoundGate(box);
    await box.getByRole('button', { name: /Start game/ }).click();
    await waitFor(() => observer.getView().snapshot?.party.status === 'live', 'party live');

    await bet(ayan.page, 'Yes');
    await bet(priya.page, 'No');
    const before = await getParty(engine.url, code);
    const stakeOf = (n: string) => before.players.find((p) => p.name === n)!;
    expect(stakeOf('Ayan').balance).toBeLessThan(10 * USDC);
    expect(stakeOf('Priya').balance).toBeLessThan(10 * USDC);

    // The game runs to the end and the party is paid out.
    await expect.poll(async () => (await getParty(engine.url, code)).party.status, { timeout: 150_000 }).toBe('finalized');
    await waitFor(() => observer.getView().snapshot?.party.status === 'finalized', 'observer sees finalized');
    // Each phone is the foreground page on a real device; in one headless browser only the front
    // page runs animation frames, so bring each to the front before reading it (framer-motion
    // AnimatePresence waits for an exit animation before showing the end screen).
    for (const p of [ayan.page, priya.page]) {
      await p.bringToFront();
      console.log('DEBUG', (await p.locator('body').innerText()).slice(0, 600).replace(/\n/g, '|'));
      await expect(p.getByText('Final points')).toBeVisible();
    }
    const final = await getParty(engine.url, code);
    expect(final.party.status).toBe('finalized');

    // The market both phones bet on resolved, and money moved.
    const market = observer.getView().snapshot!.markets.find((m: Market) => MARKET_Q.test(m.question))!;
    expect(['resolved', 'final']).toContain(market.state);
    expect(market.outcome).toMatch(/^(yes|no)$/);
    const winner = market.outcome === 'yes' ? 'Ayan' : 'Priya';
    const loser = winner === 'Ayan' ? 'Priya' : 'Ayan';
    const by = (n: string) => final.players.find((p) => p.name === n)!;
    expect(by(winner).payout).toBeGreaterThan(by(loser).payout!);
    expect(by(loser).payout).toBeLessThan(10 * USDC);

    // Points settlement: payouts (players + house) sum exactly to deposits.
    const deposits = final.players.reduce((a, p) => a + p.deposited, 0);
    const payouts = final.players.reduce((a, p) => a + (p.payout ?? 0), 0);
    expect(payouts).toBe(deposits);

    // Each phone shows its own payout; the box shows the end of the game.
    for (const [name, page] of [['Ayan', ayan.page], ['Priya', priya.page]] as const) {
      await page.bringToFront();
      await expect(page.getByText(pts(by(name).payout!), { exact: true }).first()).toBeVisible();
    }
    await box.bringToFront();
    await expect(box.getByText('Payout landed').first()).toBeVisible();

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
    // The house funds 6 per AMM market from a 50 budget, so later AMM markets fall back to pool (A2-8).
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
