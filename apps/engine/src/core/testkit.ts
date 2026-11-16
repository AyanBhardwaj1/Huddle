import {
  DEFAULT_PARTY_CONFIG,
  USDC,
  generateKeyPair,
  signState,
  type KeyPair,
  type Party,
  type PartyConfig,
} from '@huddle/shared';
import { PartyCore, type CoreTiming, type NewMarketInput } from './party-core';

/** Test helpers for the pure core: a party with a funded house and N funded players. */

export const T0 = Date.parse('2026-11-16T20:00:00Z');

export interface Kit {
  core: PartyCore;
  house: KeyPair;
  box: KeyPair;
  players: KeyPair[];
  /** Countersign every pending state for every player, like the phones do. */
  cosignAll(): void;
  /** sum(balances) + sum(escrows) == deposits, straight from the ledger. */
  assertMoney(): void;
  total(): number;
}

export function makeKit(
  opts: { config?: Partial<PartyConfig>; players?: number; buyIn?: number; houseBudget?: number; timing?: Partial<CoreTiming>; timeScale?: number } = {},
): Kit {
  const house = generateKeyPair();
  const box = generateKeyPair();
  const houseBudget = opts.houseBudget ?? 20 * USDC;
  const config: PartyConfig = { ...DEFAULT_PARTY_CONFIG, houseBudget, houseBudgetPerMarket: 2 * USDC, ...opts.config };
  const party: Party = {
    id: 'p1',
    code: 'TEST',
    name: 'Test party',
    hostPubkey: house.publicKey,
    boxSigner: box.publicKey,
    game: {
      id: 'mock-soccer',
      sport: 'soccer',
      title: 'Portugal vs Spain',
      home: { name: 'Portugal', short: 'POR' },
      away: { name: 'Spain', short: 'ESP' },
      status: 'replay',
      source: 'mock',
    },
    config,
    status: 'live',
    createdAt: new Date(T0).toISOString(),
    chain: { partyAddress: generateKeyPair().publicKey },
    joinUrl: 'http://localhost/j/TEST',
  };
  const coreInit: ConstructorParameters<typeof PartyCore>[0] = { party, house, boxSecretKey: box.secretKey };
  if (opts.timing) coreInit.timing = opts.timing;
  if (opts.timeScale) coreInit.timeScale = opts.timeScale;
  const core = new PartyCore(coreInit);
  if (houseBudget > 0) core.creditDeposit(house.publicKey, houseBudget, 'house-deposit', T0);
  const players: KeyPair[] = [];
  const names = ['Ayan', 'Jake', 'Priya', 'Mateo', 'Zoe', 'Kenji'];
  for (let i = 0; i < (opts.players ?? 3); i++) {
    const kp = generateKeyPair();
    players.push(kp);
    core.join(kp.publicKey, { name: names[i] ?? `P${i}` }, T0);
    core.creditDeposit(kp.publicKey, opts.buyIn ?? 10 * USDC, `dep-${i}`, T0);
  }
  const kit: Kit = {
    core,
    house,
    box,
    players,
    cosignAll(): void {
      for (const kp of players) {
        for (const r of core.ledger.unsigned(kp.publicKey)) {
          const s = r.state;
          const sig = signState(
            { party: party.chain.partyAddress, member: s.member, nonce: s.nonce, balance: s.balance, stateHash: s.stateHash },
            kp.secretKey,
          );
          core.cosign(kp.publicKey, s.nonce, sig);
        }
      }
    },
    assertMoney(): void {
      const c = core.ledger.checkInvariant();
      if (!c.ok) throw new Error(`money invariant broken: ${JSON.stringify(c)}`);
    },
    total(): number {
      return core.ledger.totalDeposits;
    },
  };
  core.drainEffects();
  core.drainDirty();
  return kit;
}

export const YES_NO = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
];

export function binary(over: Partial<NewMarketInput> = {}): NewMarketInput {
  return {
    question: 'Will Ronaldo score this penalty?',
    kind: 'moment',
    outcomes: YES_NO,
    prior: { yes: 0.77, no: 0.23 },
    resolver: { type: 'penalty_result', params: {} },
    createdBy: 'ai',
    ...over,
  };
}

/** Create and open a market in one step. */
export function openMarket(kit: Kit, over: Partial<NewMarketInput> = {}, now = T0): string {
  const m = kit.core.createMarket(binary(over), now);
  kit.core.openMarket(m.id, now);
  return m.id;
}
