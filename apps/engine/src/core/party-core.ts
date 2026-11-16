import { Decimal } from 'decimal.js';
import {
  addShares,
  buildScorecard,
  defaultOddsForPrior,
  fillOffer,
  impliedProb,
  lmsrInitQ,
  lmsrLiquidity,
  lmsrPrices,
  normalizePrior,
  poolShares,
  quoteBuyShares,
  quoteBuySpend,
  quoteSell,
  randomId,
  roundOdds,
  sharesGt,
  sharesIsZero,
  subShares,
  type AnnouncerEvent,
  type BetOffer,
  type DraftBet,
  type Fill,
  type FillKind,
  type GeminiRef,
  type LedPattern,
  type Market,
  type MarketCandidate,
  type MarketMode,
  type MarketResolver,
  type Outcome,
  type Party,
  type PartyStatus,
  type PlayerPublic,
  type Position,
  type Scorecard,
  type ScorecardEntry,
} from '@huddle/shared';
import {
  atRisk,
  emptyBook,
  participants,
  positionsOf,
  resolveDistribution,
  takerOutcome,
  voidDistribution,
  type Book,
  type Credit,
} from './book';
import { EngineError, InvariantError } from './errors';
import { Ledger, LedgerTx, isPubkey, type StateRecord } from './ledger';

/**
 * The party state machine: members, markets (lifecycle + the three mode engines), the ledger,
 * drafts and the scorecard. Pure and synchronous: no I/O, no timers, no clocks (every method takes
 * `now`). Callers drain `effects` (what to tell clients) and `dirty` (what to persist) after each call.
 */

export interface CoreTiming {
  /** D6: an un-countersigned state older than this blocks new bets. */
  cosignGraceMs: number;
  /** Announce "last call" this many seconds before a countdown lock. */
  lockSoonSecs: number;
  draftTtlMs: number;
  /** At most one new moment market per this gap (PRD section 6). */
  momentGapMs: number;
  maxOpenMoment: number;
  /** A fill of at least this fraction of the buy-in is a "big trade" for the announcer. */
  bigTradeFraction: number;
  /** Remote players this far out of sync lose moment markets (PRD section 12). Not time-scaled. */
  maxSyncDelayMs: number;
}

export const DEFAULT_CORE_TIMING: CoreTiming = {
  cosignGraceMs: 10_000,
  lockSoonSecs: 5,
  draftTtlMs: 60_000,
  momentGapMs: 20_000,
  maxOpenMoment: 3,
  bigTradeFraction: 0.5,
  maxSyncDelayMs: 15_000,
};

export interface MemberInfo {
  pubkey: string;
  name: string;
  isHouse: boolean;
  remote: boolean;
  city?: string;
  joinedAt: string;
  streak: number;
  payout?: number;
  withdrawTx?: string;
  delayMs?: number;
  momentMarketsAllowed: boolean;
}

export interface MarketRec {
  market: Market;
  book: Book;
}

export type Effect =
  | { t: 'party' }
  | { t: 'market'; id: string }
  | { t: 'price'; id: string }
  | { t: 'offer'; id: string }
  | { t: 'fill'; fill: Fill }
  | { t: 'state'; record: StateRecord }
  | { t: 'positions'; member: string; marketId: string }
  | { t: 'leaderboard' }
  | { t: 'scorecard' }
  | { t: 'draft'; draft: DraftBet }
  | { t: 'draft_removed'; member: string; draftId: string }
  | { t: 'sync'; member: string }
  | { t: 'announce'; event: AnnouncerEvent }
  | { t: 'led'; pattern: LedPattern }
  | { t: 'note'; message: string; box: boolean };

export interface Dirty {
  party: boolean;
  members: Set<string>;
  markets: Set<string>;
  offers: Set<string>;
  fills: Fill[];
  states: StateRecord[];
  cosigns: { member: string; nonce: number; memberSig: string }[];
  /** Market ids whose scorecard entry changed (missing from the map = deleted). */
  scorecard: Set<string>;
  /** Draft ids that changed (missing from the map = deleted). */
  drafts: Set<string>;
  deposits: { signature: string; member: string; amount: number; at: string }[];
}

function emptyDirty(): Dirty {
  return {
    party: false,
    members: new Set(),
    markets: new Set(),
    offers: new Set(),
    fills: [],
    states: [],
    cosigns: [],
    scorecard: new Set(),
    drafts: new Set(),
    deposits: [],
  };
}

export interface NewMarketInput {
  question: string;
  hook?: string;
  kind: 'moment' | 'game';
  mode?: MarketMode;
  outcomes: Outcome[];
  prior: Record<string, number>;
  lockAfterSecs?: number;
  lockOnEvent?: string;
  resolver: MarketResolver;
  createdBy: 'ai' | 'host' | 'player';
  templateId?: string;
  createdAtSeq?: number;
  geminiRef?: GeminiRef;
  geminiHint?: MarketCandidate['geminiHint'];
  rationale?: string;
}

export interface CoreMisc {
  lastMomentAt: number;
  fillSeq: number;
  leader?: string;
  biggestSwing?: { name: string; amount: number; question: string };
  recentResults: { question: string; outcome: string }[];
}

export interface CoreInit {
  party: Party;
  house: { publicKey: string; secretKey: Uint8Array };
  boxSecretKey: Uint8Array;
  timeScale?: number;
  timing?: Partial<CoreTiming>;
}

/** What storage hands back to rebuild a party after a restart. */
export interface CoreSnapshot {
  members: { info: MemberInfo; account: { balance: number; deposited: number; nonce: number; stateHash: string; entrySeq: number } }[];
  /** Every balance state per member, ascending nonce. */
  states: Map<string, StateRecord[]>;
  markets: { rec: MarketRec; escrow: number }[];
  offers: BetOffer[];
  fills: Fill[];
  scorecard: ScorecardEntry[];
  drafts: DraftBet[];
  /** Transaction signatures of deposits already credited. */
  deposits: string[];
  misc?: Partial<CoreMisc>;
}

const MAX_FILLS = 50;
const sum = (xs: Iterable<number>): number => {
  let s = 0;
  for (const x of xs) s += x;
  return s;
};

export class PartyCore {
  readonly party: Party;
  readonly ledger: Ledger;
  readonly members = new Map<string, MemberInfo>();
  readonly markets = new Map<string, MarketRec>();
  readonly offers = new Map<string, BetOffer>();
  readonly drafts = new Map<string, DraftBet>();
  readonly scoreEntries = new Map<string, ScorecardEntry>();
  readonly creditedDeposits = new Set<string>();
  /** Connection counts per member, maintained by the hub. */
  readonly connected = new Map<string, number>();
  fills: Fill[] = [];
  scorecard: Scorecard = buildScorecard([]);
  misc: CoreMisc = { lastMomentAt: 0, fillSeq: 0, recentResults: [] };

  effects: Effect[] = [];
  dirty: Dirty = emptyDirty();

  readonly timing: CoreTiming;
  readonly timeScale: number;
  readonly houseKey: string;

  constructor(init: CoreInit) {
    this.party = init.party;
    this.timeScale = init.timeScale && init.timeScale > 0 ? init.timeScale : 1;
    this.timing = { ...DEFAULT_CORE_TIMING, ...init.timing };
    this.houseKey = init.house.publicKey;
    this.ledger = new Ledger({
      partyAddress: init.party.chain.partyAddress,
      boxSecretKey: init.boxSecretKey,
      selfSigners: new Map([[init.house.publicKey, init.house.secretKey]]),
    });
    if (!this.members.has(this.houseKey)) {
      this.members.set(this.houseKey, {
        pubkey: this.houseKey,
        name: 'House',
        isHouse: true,
        remote: false,
        joinedAt: init.party.createdAt,
        streak: 0,
        momentMarketsAllowed: true,
      });
      this.ledger.addMember(this.houseKey);
      this.dirty.members.add(this.houseKey);
    }
    this.dirty.party = true;
  }

  /** Rebuild the in-memory state from storage after a restart, then re-check the money invariant. */
  hydrate(data: CoreSnapshot): void {
    this.members.clear();
    this.ledger.accounts.clear();
    this.ledger.escrow.clear();
    let deposits = 0;
    for (const m of data.members) {
      this.members.set(m.info.pubkey, m.info);
      this.ledger.restoreAccount({ ...m.account, pubkey: m.info.pubkey, records: data.states.get(m.info.pubkey) ?? [] });
      deposits += m.account.deposited;
    }
    this.ledger.totalDeposits = deposits;
    this.markets.clear();
    for (const m of data.markets) {
      this.markets.set(m.rec.market.id, m.rec);
      if (m.escrow !== 0) this.ledger.escrow.set(m.rec.market.id, m.escrow);
    }
    this.offers.clear();
    for (const o of data.offers) this.offers.set(o.id, o);
    this.fills = data.fills.slice(-MAX_FILLS);
    this.scoreEntries.clear();
    for (const e of data.scorecard) this.scoreEntries.set(e.marketId, e);
    this.scorecard = buildScorecard([...this.scoreEntries.values()]);
    this.drafts.clear();
    for (const d of data.drafts) this.drafts.set(d.id, d);
    this.creditedDeposits.clear();
    for (const s of data.deposits) this.creditedDeposits.add(s);
    this.misc = { ...this.misc, ...data.misc };
    for (const [pubkey, acct] of this.ledger.accounts) {
      const last = acct.records.at(-1)?.state;
      if ((last?.nonce ?? 0) !== acct.nonce || (last && last.balance !== acct.balance)) {
        throw new InvariantError(`stored states for ${pubkey} do not match the stored balance`);
      }
    }
    this.ledger.assertInvariant();
    this.effects = [];
    this.dirty = emptyDirty();
  }

  // ───────────────────────── helpers ─────────────────────────

  /** A nominal duration (ms) converted to engine time (tests run with timeScale > 1). */
  scaled(ms: number): number {
    return ms / this.timeScale;
  }

  get config(): Party['config'] {
    return this.party.config;
  }

  drainEffects(): Effect[] {
    const e = this.effects;
    this.effects = [];
    return e;
  }

  drainDirty(): Dirty {
    const d = this.dirty;
    this.dirty = emptyDirty();
    return d;
  }

  private fx(e: Effect): void {
    this.effects.push(e);
  }

  private touchMarket(id: string, price = false): void {
    this.dirty.markets.add(id);
    this.fx(price ? { t: 'price', id } : { t: 'market', id });
  }

  private commit(tx: LedgerTx, now: number): StateRecord[] {
    if (tx.empty) return [];
    const records = this.ledger.commit(tx, now);
    // Escrow is persisted with its market.
    for (const id of tx.escrow.keys()) this.dirty.markets.add(id);
    for (const record of records) {
      this.dirty.states.push(record);
      this.dirty.members.add(record.state.member);
      this.fx({ t: 'state', record });
    }
    if (records.length) this.fx({ t: 'leaderboard' });
    return records;
  }

  nameOf(pubkey: string): string {
    return this.members.get(pubkey)?.name ?? pubkey.slice(0, 4);
  }

  rec(marketId: string): MarketRec {
    const rec = this.markets.get(marketId);
    if (!rec) throw new EngineError('not_found', 'No such market');
    return rec;
  }

  private outcomeLabel(market: Market, outcome: string): string {
    return market.outcomes.find((o) => o.id === outcome)?.label ?? outcome;
  }

  private assertOutcome(market: Market, outcome: string): void {
    if (!market.outcomes.some((o) => o.id === outcome)) throw new EngineError('bad_request', 'Unknown outcome');
  }

  private addFill(
    market: Market,
    player: string,
    kind: FillKind,
    outcome: string,
    amount: number,
    now: number,
    extra: { shares?: string; price?: number } = {},
  ): Fill {
    const fill: Fill = {
      id: `f${++this.misc.fillSeq}`,
      marketId: market.id,
      player,
      playerName: this.nameOf(player),
      kind,
      outcome,
      amount,
      at: new Date(now).toISOString(),
      ...extra,
    };
    this.fills.push(fill);
    if (this.fills.length > MAX_FILLS) this.fills = this.fills.slice(-MAX_FILLS);
    this.dirty.fills.push(fill);
    this.dirty.party = true;
    this.fx({ t: 'fill', fill });
    const big = this.timing.bigTradeFraction * this.config.buyIn;
    if (amount >= big && (kind === 'pool_bet' || kind === 'amm_buy' || kind === 'offer_posted' || kind === 'offer_taken')) {
      this.fx({
        t: 'announce',
        event: { type: 'big_trade', market: structuredClone(market), fill, outcomeLabel: this.outcomeLabel(market, outcome) },
      });
    }
    return fill;
  }

  private offersOf(marketId: string): BetOffer[] {
    const out: BetOffer[] = [];
    for (const o of this.offers.values()) if (o.marketId === marketId) out.push(o);
    return out;
  }

  atRiskOf(rec: MarketRec, player: string): number {
    return atRisk(rec.market, rec.book, this.offersOf(rec.market.id), player);
  }

  positionsFor(player: string, marketId?: string): Position[] {
    const out: Position[] = [];
    for (const rec of this.markets.values()) {
      if (marketId && rec.market.id !== marketId) continue;
      if (rec.market.state !== 'open' && rec.market.state !== 'locked') continue;
      out.push(...positionsOf(rec.market, rec.book, player));
    }
    return out;
  }

  /** Every open position in a market (for the positions table). */
  allPositions(marketId: string): Position[] {
    const rec = this.markets.get(marketId);
    if (!rec) return [];
    const out: Position[] = [];
    for (const p of participants(rec.market, rec.book, this.offersOf(marketId))) {
      out.push(...positionsOf(rec.market, rec.book, p));
    }
    return out;
  }

  // ───────────────────────── members ─────────────────────────

  join(pubkey: string, opts: { name?: string; remote?: boolean; city?: string }, now: number): MemberInfo {
    let m = this.members.get(pubkey);
    if (m?.isHouse) throw new EngineError('unauthorized', 'The house account cannot join as a player');
    if (!m) {
      if (this.party.status === 'closing' || this.party.status === 'finalized' || this.party.status === 'ended') {
        throw new EngineError('party_closed', 'This party is over');
      }
      if (!isPubkey(pubkey)) throw new EngineError('bad_request', 'Invalid player key');
      m = {
        pubkey,
        name: (opts.name ?? '').trim() || `Player ${pubkey.slice(0, 4)}`,
        isHouse: false,
        remote: opts.remote ?? false,
        joinedAt: new Date(now).toISOString(),
        streak: 0,
        momentMarketsAllowed: true,
      };
      if (opts.city) m.city = opts.city;
      this.members.set(pubkey, m);
      this.ledger.addMember(pubkey);
      this.dirty.members.add(pubkey);
      this.fx({ t: 'leaderboard' });
      return m;
    }
    const name = (opts.name ?? '').trim();
    let changed = false;
    if (name && name !== m.name) {
      m.name = name;
      changed = true;
    }
    if (opts.remote !== undefined && opts.remote !== m.remote) {
      m.remote = opts.remote;
      changed = true;
    }
    if (opts.city && opts.city !== m.city) {
      m.city = opts.city;
      changed = true;
    }
    if (changed) {
      this.dirty.members.add(pubkey);
      this.fx({ t: 'leaderboard' });
    }
    return m;
  }

  /**
   * Credit a confirmed deposit exactly once (keyed by transaction signature), however the
   * confirmation arrived. Returns false when it was already credited.
   */
  creditDeposit(member: string, amount: number, signature: string, now: number): boolean {
    if (this.creditedDeposits.has(signature)) return false;
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new EngineError('bad_request', 'Invalid deposit amount');
    let info = this.members.get(member);
    if (!info) {
      if (!isPubkey(member)) throw new EngineError('bad_request', 'Invalid wallet address');
      // A deposit made outside the app (e.g. an external wallet): the money is in the vault, so track it.
      info = {
        pubkey: member,
        name: `Player ${member.slice(0, 4)}`,
        isHouse: false,
        remote: true,
        joinedAt: new Date(now).toISOString(),
        streak: 0,
        momentMarketsAllowed: true,
      };
      this.members.set(member, info);
      this.ledger.addMember(member);
    }
    this.creditedDeposits.add(signature);
    this.commit(new LedgerTx().deposit(member, amount), now);
    this.dirty.deposits.push({ signature, member, amount, at: new Date(now).toISOString() });
    this.dirty.members.add(member);
    if (!info.isHouse) {
      const ev: AnnouncerEvent = { type: 'player_joined', name: info.name, amount, remote: info.remote };
      if (info.city) ev.city = info.city;
      this.fx({ t: 'announce', event: ev });
      this.fx({ t: 'led', pattern: 'join' });
    }
    return true;
  }

  cosign(member: string, nonce: number, signature: string): void {
    const record = this.ledger.cosign(member, nonce, signature);
    if (record) this.dirty.cosigns.push({ member, nonce, memberSig: signature });
  }

  setSync(member: string, delayMs: number): MemberInfo {
    const m = this.members.get(member);
    if (!m) throw new EngineError('not_joined', 'Join the party first');
    m.delayMs = Math.round(delayMs);
    m.momentMarketsAllowed = Math.abs(delayMs) <= this.timing.maxSyncDelayMs;
    this.dirty.members.add(member);
    this.fx({ t: 'sync', member });
    return m;
  }

  setStatus(status: PartyStatus): void {
    if (this.party.status === status) return;
    this.party.status = status;
    this.dirty.party = true;
    this.fx({ t: 'party' });
  }

  touchParty(): void {
    this.dirty.party = true;
    this.fx({ t: 'party' });
  }

  setPayout(member: string, payout: number, withdrawTx?: string): void {
    const m = this.members.get(member);
    if (!m) return;
    m.payout = payout;
    if (withdrawTx) m.withdrawTx = withdrawTx;
    this.dirty.members.add(member);
    this.fx({ t: 'leaderboard' });
  }

  lockedOf(player: string): number {
    let locked = 0;
    for (const rec of this.markets.values()) {
      if (rec.book.applied) continue;
      if (rec.market.state !== 'open' && rec.market.state !== 'locked') continue;
      locked += this.atRiskOf(rec, player);
      if (player === this.houseKey) locked += rec.book.houseEscrow;
    }
    return locked;
  }

  /** Leaderboard: players by profit, the house last. */
  players(): PlayerPublic[] {
    const out: PlayerPublic[] = [];
    for (const m of this.members.values()) {
      const acct = this.ledger.accounts.get(m.pubkey);
      const balance = acct?.balance ?? 0;
      const deposited = acct?.deposited ?? 0;
      const locked = this.lockedOf(m.pubkey);
      const p: PlayerPublic = {
        pubkey: m.pubkey,
        name: m.name,
        isHouse: m.isHouse,
        remote: m.remote,
        connected: m.isHouse || (this.connected.get(m.pubkey) ?? 0) > 0,
        deposited,
        balance,
        locked,
        pnl: balance + locked - deposited,
        joinedAt: m.joinedAt,
        streak: m.streak,
      };
      if (m.payout !== undefined) p.payout = m.payout;
      if (m.withdrawTx) p.withdrawTx = m.withdrawTx;
      out.push(p);
    }
    return out.sort((a, b) => Number(a.isHouse) - Number(b.isHouse) || b.pnl - a.pnl || a.joinedAt.localeCompare(b.joinedAt));
  }

  // ───────────────────────── trade pre-checks ─────────────────────────

  private preTrade(player: string, rec: MarketRec, now: number): MemberInfo {
    if (this.party.status !== 'lobby' && this.party.status !== 'live') {
      throw new EngineError('party_closed', 'Betting is closed for this party');
    }
    const info = this.members.get(player);
    if (!info) throw new EngineError('not_joined', 'Join the party first');
    if (info.isHouse) throw new EngineError('unauthorized', 'The house does not bet');
    const m = rec.market;
    if (m.state !== 'open') throw new EngineError('market_closed', 'This market is not open');
    if (m.lock.at && now >= Date.parse(m.lock.at)) throw new EngineError('market_closed', 'This market just locked');
    if (m.kind === 'moment' && !info.momentMarketsAllowed) {
      throw new EngineError('delay_restricted', 'Your stream is out of sync with the room, so only game-long markets are open to you');
    }
    this.assertCosigned(player, now);
    return info;
  }

  /** D6: no new bets while a state older than the grace period is un-countersigned. */
  private assertCosigned(player: string, now: number): void {
    if (!this.config.requireMemberSig) return;
    const oldest = this.ledger.unsigned(player)[0];
    if (oldest && now - oldest.createdAt > this.scaled(this.timing.cosignGraceMs)) {
      throw new EngineError('cosign_required', 'Waiting for your phone to confirm your last balance');
    }
  }

  /**
   * Stake limits (PRD section 5): at least the minimum, never more than the available balance, and
   * the player's total in this market never above `maxStakeFraction` of (balance + what they already
   * have in this market).
   */
  private checkStake(player: string, rec: MarketRec, requested: number, charge: number, opts: { skipMin?: boolean } = {}): void {
    if (!opts.skipMin && requested < this.config.minStake) {
      throw new EngineError('min_stake', `Minimum stake is ${(this.config.minStake / 1_000_000).toFixed(2)}`);
    }
    const balance = this.ledger.balanceOf(player);
    if (charge > balance) throw new EngineError('insufficient_funds', 'Not enough balance');
    const existing = this.atRiskOf(rec, player);
    const cap = Math.floor(this.config.maxStakeFraction * (balance + existing));
    if (existing + charge > cap) {
      const pct = Math.round(this.config.maxStakeFraction * 100);
      throw new EngineError('stake_limit', `You can put at most ${pct}% of your balance on one market`);
    }
  }

  /** Largest additional stake the limits allow for a player in a market (used by bots and the UI hint). */
  maxStakeFor(player: string, marketId: string): number {
    const rec = this.rec(marketId);
    const balance = this.ledger.balanceOf(player);
    const existing = this.atRiskOf(rec, player);
    return Math.max(0, Math.min(balance, Math.floor(this.config.maxStakeFraction * (balance + existing)) - existing));
  }

  private sendPositions(rec: MarketRec, players: Iterable<string>): void {
    for (const p of new Set(players)) {
      if (p !== this.houseKey) this.fx({ t: 'positions', member: p, marketId: rec.market.id });
    }
  }

  // ───────────────────────── trading ─────────────────────────

  /** One-tap bet: pool stake, AMM buy with `stake` as the spend, or a Bet-mode auto-match (D10). */
  placeBet(player: string, marketId: string, outcome: string, stake: number, now: number): Record<string, unknown> {
    const rec = this.rec(marketId);
    this.preTrade(player, rec, now);
    this.assertOutcome(rec.market, outcome);
    if (rec.market.mode === 'pool') return this.poolBet(player, rec, outcome, stake, now);
    if (rec.market.mode === 'amm') return this.ammBuy(player, rec, outcome, { spend: stake }, now);
    return this.oneTapBet(player, rec, outcome, stake, now);
  }

  private poolBet(player: string, rec: MarketRec, outcome: string, stake: number, now: number): Record<string, unknown> {
    const { market, book } = rec;
    this.checkStake(player, rec, stake, stake);
    this.commit(new LedgerTx().debit(player, stake, 'stake', market.id).hold(market.id, stake), now);
    const mine = (book.stakes[player] ??= {});
    mine[outcome] = (mine[outcome] ?? 0) + stake;
    market.pool = { ...(market.pool ?? {}), [outcome]: (market.pool?.[outcome] ?? 0) + stake };
    market.volume += stake;
    market.price = poolShares(market.pool, market.outcomes.map((o) => o.id), market.prior);
    this.touchMarket(market.id, true);
    this.addFill(market, player, 'pool_bet', outcome, stake, now, { price: market.price[outcome] });
    // Everyone's potential payout moves with the pool.
    this.sendPositions(rec, Object.keys(book.stakes));
    return { stake };
  }

  /** AMM trade: buy by shares or spend, sell by shares or "all" (cash out). */
  ammTrade(
    player: string,
    marketId: string,
    outcome: string,
    side: 'buy' | 'sell',
    args: { shares?: string; spend?: number },
    now: number,
  ): Record<string, unknown> {
    const rec = this.rec(marketId);
    this.preTrade(player, rec, now);
    this.assertOutcome(rec.market, outcome);
    if (rec.market.mode !== 'amm') throw new EngineError('bad_request', 'This market is not in Market mode');
    if (side === 'buy') {
      const hasShares = args.shares !== undefined;
      const hasSpend = args.spend !== undefined;
      if (hasShares === hasSpend) throw new EngineError('bad_request', 'Give exactly one of shares or spend');
      if (args.shares === 'all') throw new EngineError('bad_request', '"all" only works for selling');
      return this.ammBuy(player, rec, outcome, hasShares ? { shares: args.shares! } : { spend: args.spend! }, now);
    }
    if (args.shares === undefined) throw new EngineError('bad_request', 'Say how many shares to sell');
    return this.ammSell(player, rec, outcome, args.shares, now);
  }

  private ammBuy(
    player: string,
    rec: MarketRec,
    outcome: string,
    args: { shares: string } | { spend: number },
    now: number,
  ): Record<string, unknown> {
    const { market, book } = rec;
    if (!market.q || !market.ammB) throw new InvariantError('amm market without liquidity');
    if ('spend' in args && args.spend < this.config.minStake) {
      throw new EngineError('min_stake', `Minimum stake is ${(this.config.minStake / 1_000_000).toFixed(2)}`);
    }
    let quote;
    try {
      quote = 'spend' in args ? quoteBuySpend(market.q, market.ammB, outcome, args.spend) : quoteBuyShares(market.q, market.ammB, outcome, args.shares);
    } catch (e) {
      const msg = (e as Error).message;
      throw new EngineError(msg.includes('too small') ? 'min_stake' : 'bad_request', msg);
    }
    if (!Number.isSafeInteger(quote.cost)) throw new EngineError('bad_request', 'Trade too large');
    this.checkStake(player, rec, 'spend' in args ? args.spend : quote.cost, quote.cost);
    this.commit(new LedgerTx().debit(player, quote.cost, 'trade_buy', market.id).hold(market.id, quote.cost), now);
    const mine = (book.holdings[player] ??= {});
    const h = (mine[outcome] ??= { shares: '0', cost: 0 });
    h.shares = addShares(h.shares, quote.shares);
    h.cost += quote.cost;
    book.netCost[player] = (book.netCost[player] ?? 0) + quote.cost;
    market.q = quote.newQ;
    market.price = lmsrPrices(market.q, market.ammB);
    market.volume += quote.cost;
    this.touchMarket(market.id, true);
    this.addFill(market, player, 'amm_buy', outcome, quote.cost, now, { shares: quote.shares, price: quote.priceAfter });
    this.sendPositions(rec, [player]);
    return { shares: quote.shares, cost: quote.cost, avgPrice: quote.avgPrice };
  }

  private ammSell(player: string, rec: MarketRec, outcome: string, sharesArg: string, now: number): Record<string, unknown> {
    const { market, book } = rec;
    if (!market.q || !market.ammB) throw new InvariantError('amm market without liquidity');
    const h = book.holdings[player]?.[outcome];
    if (!h || sharesIsZero(h.shares)) throw new EngineError('bad_request', 'You have no shares to sell');
    const shares = sharesArg === 'all' ? h.shares : sharesArg;
    if (sharesGt(shares, h.shares)) throw new EngineError('insufficient_funds', 'You do not hold that many shares');
    let quote;
    try {
      quote = quoteSell(market.q, market.ammB, outcome, shares);
    } catch (e) {
      throw new EngineError('bad_request', (e as Error).message);
    }
    this.commit(new LedgerTx().credit(player, quote.proceeds, 'trade_sell', market.id).hold(market.id, -quote.proceeds), now);
    const remaining = subShares(h.shares, quote.shares);
    // Reduce the displayed cost basis pro rata (rounded down); the void refund uses netCost, not this.
    const sold = new Decimal(quote.shares).div(h.shares);
    h.cost = sharesIsZero(remaining) ? 0 : h.cost - new Decimal(h.cost).mul(sold).floor().toNumber();
    h.shares = remaining;
    book.netCost[player] = (book.netCost[player] ?? 0) - quote.proceeds;
    market.q = quote.newQ;
    market.price = lmsrPrices(market.q, market.ammB);
    market.volume += quote.proceeds;
    this.touchMarket(market.id, true);
    this.addFill(market, player, 'amm_sell', outcome, quote.proceeds, now, { shares: quote.shares, price: quote.priceAfter });
    this.sendPositions(rec, [player]);
    this.fx({ t: 'leaderboard' });
    return { shares: quote.shares, proceeds: quote.proceeds, avgPrice: quote.avgPrice };
  }

  postOffer(player: string, marketId: string, side: string, makerStake: number, oddsIn: number, now: number): Record<string, unknown> {
    const rec = this.rec(marketId);
    this.preTrade(player, rec, now);
    this.assertOutcome(rec.market, side);
    if (rec.market.mode !== 'bet') throw new EngineError('bad_request', 'This market is not in Bet mode');
    this.checkStake(player, rec, makerStake, makerStake);
    const tx = new LedgerTx();
    const offer = this.buildOffer(player, rec, side, makerStake, oddsIn, now, tx);
    this.commit(tx, now);
    this.registerOffer(rec, offer, now);
    return { offerId: offer.id, odds: offer.odds };
  }

  private buildOffer(player: string, rec: MarketRec, side: string, makerStake: number, oddsIn: number, now: number, tx: LedgerTx): BetOffer {
    const odds = roundOdds(oddsIn);
    tx.debit(player, makerStake, 'offer_lock', rec.market.id).hold(rec.market.id, makerStake);
    return {
      id: `o_${randomId(5)}`,
      marketId: rec.market.id,
      maker: player,
      side,
      makerStake,
      odds,
      filled: 0,
      open: true,
      makerName: this.nameOf(player),
      createdAt: new Date(now).toISOString(),
    };
  }

  private registerOffer(rec: MarketRec, offer: BetOffer, now: number): void {
    this.offers.set(offer.id, offer);
    this.dirty.offers.add(offer.id);
    this.fx({ t: 'offer', id: offer.id });
    this.addFill(rec.market, offer.maker, 'offer_posted', offer.side, offer.makerStake, now, { price: impliedProb(offer.odds) });
  }

  takeOffer(player: string, offerId: string, amount: number, now: number): Record<string, unknown> {
    const offer = this.offers.get(offerId);
    if (!offer) throw new EngineError('not_found', 'No such offer');
    const rec = this.rec(offer.marketId);
    this.preTrade(player, rec, now);
    if (!offer.open) throw new EngineError('market_closed', 'That offer is gone');
    if (offer.maker === player) throw new EngineError('bad_request', 'You cannot take your own offer');
    if (amount < this.config.minStake) {
      throw new EngineError('min_stake', `Minimum stake is ${(this.config.minStake / 1_000_000).toFixed(2)}`);
    }
    let fill;
    try {
      fill = fillOffer(offer, amount);
    } catch (e) {
      throw new EngineError('bad_request', (e as Error).message);
    }
    this.checkStake(player, rec, fill.takerStake, fill.takerStake, { skipMin: true });
    const tx = new LedgerTx().debit(player, fill.takerStake, 'stake', rec.market.id, `take ${offer.id}`).hold(rec.market.id, fill.takerStake);
    this.commit(tx, now);
    this.applyTake(rec, offer, player, fill, now);
    return { takerStake: fill.takerStake, toWin: fill.makerPortion };
  }

  private applyTake(
    rec: MarketRec,
    offer: BetOffer,
    taker: string,
    fill: { takerStake: number; makerPortion: number; newFilled: number; complete: boolean },
    now: number,
  ): void {
    const { market, book } = rec;
    book.pairs.push({ maker: offer.maker, taker, side: offer.side, makerPortion: fill.makerPortion, takerStake: fill.takerStake });
    offer.filled = fill.newFilled;
    offer.open = !fill.complete;
    this.dirty.offers.add(offer.id);
    this.fx({ t: 'offer', id: offer.id });
    market.volume += fill.takerStake + fill.makerPortion;
    if (market.outcomes.length === 2) {
      const p = Math.min(0.99, Math.max(0.01, impliedProb(offer.odds)));
      const other = market.outcomes.find((o) => o.id !== offer.side)!.id;
      market.price = { [offer.side]: p, [other]: 1 - p };
    }
    this.touchMarket(market.id, true);
    const shown = market.outcomes.length === 2 ? takerOutcome(market, offer.side) : offer.side;
    this.addFill(market, taker, 'offer_taken', shown, fill.takerStake, now, { price: market.price[shown] });
    this.sendPositions(rec, [offer.maker, taker]);
  }

  cancelOffer(player: string, offerId: string, now: number): Record<string, unknown> {
    const offer = this.offers.get(offerId);
    if (!offer) throw new EngineError('not_found', 'No such offer');
    if (offer.maker !== player) throw new EngineError('unauthorized', 'Only the maker can cancel an offer');
    if (!offer.open) throw new EngineError('market_closed', 'That offer is already closed');
    const rec = this.rec(offer.marketId);
    const rest = offer.makerStake - offer.filled;
    this.commit(new LedgerTx().credit(player, rest, 'offer_release', rec.market.id).hold(rec.market.id, -rest), now);
    offer.open = false;
    this.dirty.offers.add(offer.id);
    this.fx({ t: 'offer', id: offer.id });
    this.addFill(rec.market, player, 'offer_cancelled', offer.side, rest, now);
    return { released: rest };
  }

  /**
   * D10 one-tap Bet mode: on a binary market, take the best opposite offers that are priced within
   * 10% of the model's fair odds (or better), then post what is left as an offer at the model's odds.
   * On categorical markets (D11) a taker backs "anything but X", which is not the same as backing one
   * outcome, so the one-tap only posts an offer there.
   */
  private oneTapBet(player: string, rec: MarketRec, outcome: string, stake: number, now: number): Record<string, unknown> {
    const { market } = rec;
    if (stake < this.config.minStake) {
      throw new EngineError('min_stake', `Minimum stake is ${(this.config.minStake / 1_000_000).toFixed(2)}`);
    }
    const fairOdds = defaultOddsForPrior(market.prior[outcome] ?? 0.5);
    const plan: { offer: BetOffer; fill: ReturnType<typeof fillOffer> }[] = [];
    let remaining = stake;
    if (market.outcomes.length === 2) {
      const candidates = this.offersOf(market.id)
        .filter((o) => o.open && o.side !== outcome && o.maker !== player)
        // Lower maker odds = a better price for the taker.
        .sort((a, b) => a.odds - b.odds || a.createdAt.localeCompare(b.createdAt));
      for (const offer of candidates) {
        if (remaining <= 0) break;
        const takerOdds = offer.odds / (offer.odds - 1);
        if (takerOdds < fairOdds * 0.9) continue;
        try {
          const fill = fillOffer(offer, remaining);
          plan.push({ offer, fill });
          remaining -= fill.takerStake;
        } catch {
          /* too small for this offer's odds: try the next one */
        }
      }
    }
    const matched = stake - remaining;
    const post = remaining >= this.config.minStake ? remaining : 0;
    const charge = matched + post;
    if (charge <= 0) throw new EngineError('min_stake', 'Stake too small to match or post');
    this.checkStake(player, rec, stake, charge);
    const tx = new LedgerTx();
    for (const { offer, fill } of plan) {
      tx.debit(player, fill.takerStake, 'stake', market.id, `take ${offer.id}`).hold(market.id, fill.takerStake);
    }
    const offer = post > 0 ? this.buildOffer(player, rec, outcome, post, fairOdds, now, tx) : null;
    this.commit(tx, now);
    for (const { offer: o, fill } of plan) this.applyTake(rec, o, player, fill, now);
    if (offer) this.registerOffer(rec, offer, now);
    return { matched, posted: post, offerId: offer?.id };
  }

  // ───────────────────────── market lifecycle ─────────────────────────

  /** PRD section 6 rate limit: one new moment market per gap, and a cap on open moment markets. */
  momentAllowed(now: number): boolean {
    if (now - this.misc.lastMomentAt < this.scaled(this.timing.momentGapMs)) return false;
    let n = 0;
    for (const { market } of this.markets.values()) {
      if (market.kind === 'moment' && (market.state === 'open' || market.state === 'draft')) n++;
    }
    return n < this.timing.maxOpenMoment;
  }

  createMarket(input: NewMarketInput, now: number): Market {
    if (input.outcomes.length < 2 || input.outcomes.length > 6) throw new EngineError('bad_request', 'A market needs 2 to 6 outcomes');
    const ids = input.outcomes.map((o) => o.id);
    if (new Set(ids).size !== ids.length) throw new EngineError('bad_request', 'Outcome ids must be unique');
    const raw: Record<string, number> = {};
    for (const id of ids) raw[id] = input.prior[id] ?? 0;
    const prior = normalizePrior(raw);
    const market: Market = {
      id: `m_${randomId(5)}`,
      partyId: this.party.id,
      question: input.question,
      kind: input.kind,
      mode: input.mode ?? this.config.defaultMode,
      outcomes: input.outcomes.map((o) => ({ id: o.id, label: o.label })),
      prior,
      lock: { manual: true },
      resolver: input.resolver,
      state: 'draft',
      createdBy: input.createdBy,
      price: { ...prior },
      volume: 0,
      createdAt: new Date(now).toISOString(),
    };
    if (input.lockOnEvent) market.lock.onEvent = input.lockOnEvent;
    if (input.hook) market.hook = input.hook;
    if (input.templateId) market.templateId = input.templateId;
    if (input.createdAtSeq !== undefined) market.createdAtSeq = input.createdAtSeq;
    if (input.geminiRef) market.geminiRef = input.geminiRef;
    const book = emptyBook();
    if (input.lockAfterSecs !== undefined && input.lockAfterSecs > 0) {
      book.lockSecs = input.lockAfterSecs;
      book.lockAfterMs = this.scaled(input.lockAfterSecs * 1000);
    }
    if (input.geminiHint) book.geminiHint = input.geminiHint;
    if (input.rationale) book.rationale = input.rationale;
    this.markets.set(market.id, { market, book });
    if (market.kind === 'moment' && input.createdBy === 'ai') this.misc.lastMomentAt = now;
    this.dirty.party = true;
    this.touchMarket(market.id);
    return market;
  }

  /** Mode-specific setup when a market starts taking bets. AMM escrows the house budget (D2). */
  private setupMode(rec: MarketRec, now: number): void {
    const { market, book } = rec;
    delete market.pool;
    delete market.q;
    delete market.ammB;
    market.price = { ...market.prior };
    if (market.mode === 'amm') {
      const budget = this.config.houseBudgetPerMarket;
      const b = budget > 0 ? lmsrLiquidity(budget, market.prior) : 0;
      if (budget > 0 && b > 0 && this.ledger.balanceOf(this.houseKey) >= budget) {
        this.commit(new LedgerTx().debit(this.houseKey, budget, 'house_escrow', market.id).hold(market.id, budget), now);
        book.houseEscrow = budget;
        market.ammB = b;
        market.q = lmsrInitQ(market.prior, b);
        market.price = lmsrPrices(market.q, b);
        return;
      }
      market.mode = 'pool';
      this.fx({ t: 'note', box: true, message: `House budget is used up, so "${market.question}" opened in Pool mode` });
    }
    if (market.mode === 'pool') {
      market.pool = Object.fromEntries(market.outcomes.map((o) => [o.id, 0]));
    }
  }

  private teardownMode(rec: MarketRec, now: number): void {
    const { market, book } = rec;
    if (book.houseEscrow > 0) {
      this.commit(new LedgerTx().credit(this.houseKey, book.houseEscrow, 'house_return', market.id).hold(market.id, -book.houseEscrow), now);
      book.houseEscrow = 0;
    }
  }

  openMarket(marketId: string, now: number): Market {
    const rec = this.rec(marketId);
    const { market, book } = rec;
    if (market.state !== 'draft') throw new EngineError('bad_request', 'Only a draft can be opened');
    if (this.party.status !== 'lobby' && this.party.status !== 'live') throw new EngineError('party_closed', 'This party is over');
    this.setupMode(rec, now);
    market.state = 'open';
    market.openedAt = new Date(now).toISOString();
    if (book.lockAfterMs !== undefined) market.lock.at = new Date(now + book.lockAfterMs).toISOString();
    this.touchMarket(marketId);
    const ev: AnnouncerEvent = { type: 'market_opened', market: structuredClone(market) };
    if (book.lockSecs !== undefined) ev.lockInSecs = book.lockSecs;
    this.fx({ t: 'announce', event: ev });
    this.fx({ t: 'led', pattern: 'market_open' });
    return market;
  }

  discardDraft(marketId: string): void {
    const { market } = this.rec(marketId);
    if (market.state !== 'draft') throw new EngineError('bad_request', 'Only a draft can be discarded');
    market.state = 'discarded';
    this.touchMarket(marketId);
  }

  /** Change the party default, or one market's mode while it has no bets. */
  setMode(mode: MarketMode, marketId: string | undefined, now: number): void {
    if (!marketId) {
      this.party.config.defaultMode = mode;
      this.touchParty();
      return;
    }
    const rec = this.rec(marketId);
    const { market, book } = rec;
    if (market.state !== 'draft' && market.state !== 'open') throw new EngineError('market_closed', 'This market is already locked');
    if (market.mode === mode) return;
    if (market.state === 'draft') {
      market.mode = mode;
      this.touchMarket(marketId);
      return;
    }
    const busy = market.volume > 0 || book.pairs.length > 0 || this.offersOf(marketId).some((o) => o.open);
    if (busy) throw new EngineError('bad_request', 'This market already has bets');
    this.teardownMode(rec, now);
    market.mode = mode;
    this.setupMode(rec, now);
    this.touchMarket(marketId);
  }

  /** Bet mode: hand unmatched offer stakes back to their makers. */
  private releaseOffers(rec: MarketRec, now: number): void {
    const open = this.offersOf(rec.market.id).filter((o) => o.open);
    if (open.length === 0) return;
    const tx = new LedgerTx();
    for (const o of open) {
      const rest = o.makerStake - o.filled;
      tx.credit(o.maker, rest, 'offer_release', rec.market.id, 'unmatched at lock').hold(rec.market.id, -rest);
    }
    this.commit(tx, now);
    for (const o of open) {
      o.open = false;
      this.dirty.offers.add(o.id);
      this.fx({ t: 'offer', id: o.id });
    }
  }

  lockMarket(marketId: string, now: number, opts: { quiet?: boolean } = {}): void {
    const rec = this.rec(marketId);
    const { market } = rec;
    if (market.state !== 'open') throw new EngineError('market_closed', 'This market is not open');
    this.releaseOffers(rec, now);
    market.state = 'locked';
    market.lockedAt = new Date(now).toISOString();
    market.roomProbAtLock = { ...market.price };
    this.touchMarket(marketId);
    if (!opts.quiet) {
      this.fx({ t: 'announce', event: { type: 'market_locked', market: structuredClone(market) } });
      this.fx({ t: 'led', pattern: 'locked' });
    }
  }

  /** The newest open moment market (what the box LOCK button locks). Falls back to any open market. */
  newestOpen(): Market | undefined {
    const open = [...this.markets.values()].map((r) => r.market).filter((m) => m.state === 'open');
    const byOpened = (a: Market, b: Market): number => (b.openedAt ?? '').localeCompare(a.openedAt ?? '');
    return open.filter((m) => m.kind === 'moment').sort(byOpened)[0] ?? open.sort(byOpened)[0];
  }

  /**
   * Move a market's escrow to the given distribution. First settlement: pays the credits out of
   * escrow. Re-settlement (a dispute changed the result, or a void after resolution): applies only
   * the difference to what was already paid, atomically.
   *
   * A member who can no longer cover a claw-back is debited to zero; the shortfall is taken from the
   * house balance first (the host backs the results it posts), then pro rata from the credits.
   * Money is conserved in every case.
   */
  private settle(rec: MarketRec, credits: Credit[], now: number, memo: string): Map<string, number> {
    const { market, book } = rec;
    const fresh = book.applied === null;
    const prev = book.applied ?? {};
    const escrow = this.ledger.escrowOf(market.id);
    const target = new Map<string, number>();
    for (const c of credits) target.set(c.member, (target.get(c.member) ?? 0) + c.amount);
    const targetSum = sum(target.values());
    if (fresh ? targetSum !== escrow : targetSum !== sum(Object.values(prev))) {
      throw new InvariantError(`settlement of ${market.id} does not match its escrow`);
    }
    const delta = new Map<string, number>();
    for (const m of new Set([...target.keys(), ...Object.keys(prev)])) {
      const d = (target.get(m) ?? 0) - (prev[m] ?? 0);
      if (d !== 0) delta.set(m, d);
    }
    let shortfall = 0;
    for (const [m, d] of delta) {
      const bal = this.ledger.balanceOf(m);
      if (bal + d < 0) {
        shortfall += -(bal + d);
        delta.set(m, -bal);
      }
    }
    const adjusted = shortfall > 0;
    if (shortfall > 0) {
      const houseAfter = this.ledger.balanceOf(this.houseKey) + (delta.get(this.houseKey) ?? 0);
      const take = Math.min(shortfall, Math.max(0, houseAfter));
      if (take > 0) {
        delta.set(this.houseKey, (delta.get(this.houseKey) ?? 0) - take);
        shortfall -= take;
      }
    }
    if (shortfall > 0) {
      const positives = [...delta].filter(([, d]) => d > 0);
      const total = sum(positives.map(([, d]) => d));
      let cut = 0;
      for (const [m, d] of positives) {
        const c = Math.min(d, Number((BigInt(d) * BigInt(shortfall) + BigInt(total) - 1n) / BigInt(total)));
        delta.set(m, d - c);
        cut += c;
      }
      if (cut < shortfall) throw new InvariantError(`cannot cover settlement shortfall on ${market.id}`);
      if (cut > shortfall) delta.set(this.houseKey, (delta.get(this.houseKey) ?? 0) + (cut - shortfall));
    }
    const tx = new LedgerTx();
    if (fresh && !adjusted) {
      for (const c of credits) tx.move(c.member, c.amount, c.type, market.id, c.memo);
    } else {
      for (const [m, d] of delta) tx.move(m, d, 'adjust', market.id, memo);
    }
    if (fresh) tx.hold(market.id, -escrow);
    this.commit(tx, now);
    const applied: Record<string, number> = { ...prev };
    for (const [m, d] of delta) applied[m] = (applied[m] ?? 0) + d;
    book.applied = applied;
    book.houseEscrow = 0;
    if (this.ledger.escrowOf(market.id) !== 0) throw new InvariantError(`escrow left on settled market ${market.id}`);
    return delta;
  }

  private scoreEntry(market: Market): ScorecardEntry | null {
    const outcome = market.outcome;
    if (!outcome) return null;
    const entry: ScorecardEntry = {
      marketId: market.id,
      question: market.question,
      outcome,
      room: market.roomProbAtLock?.[outcome] ?? market.price[outcome] ?? 0,
      model: market.prior[outcome] ?? 0,
    };
    const ref = market.geminiRef;
    if (ref) {
      const refOutcome = ref.outcomeId ?? market.outcomes[0]?.id;
      if (refOutcome === outcome) entry.gemini = ref.prob;
      else if (market.outcomes.length === 2) entry.gemini = 1 - ref.prob;
    }
    return entry;
  }

  /** Recompute a market's scorecard entry (after resolution, a changed result, a void or a Gemini refresh). */
  refreshScore(marketId: string): void {
    const rec = this.markets.get(marketId);
    if (!rec) return;
    const m = rec.market;
    const counted = (m.state === 'resolved' || m.state === 'disputed' || m.state === 'final') && m.outcome !== undefined;
    const entry = counted ? this.scoreEntry(m) : null;
    if (entry) this.scoreEntries.set(marketId, entry);
    else if (!this.scoreEntries.delete(marketId)) return;
    this.scorecard = buildScorecard([...this.scoreEntries.values()]);
    this.dirty.scorecard.add(marketId);
    this.fx({ t: 'scorecard' });
  }

  setGeminiRef(marketId: string, ref: GeminiRef | undefined): void {
    const rec = this.markets.get(marketId);
    if (!rec) return;
    if (ref) rec.market.geminiRef = ref;
    else delete rec.market.geminiRef;
    this.touchMarket(marketId);
    this.refreshScore(marketId);
  }

  /**
   * Set the result. From open/locked: lock if needed, pay out, start the dispute window.
   * From resolved/disputed (host only): keep or change the outcome, reversing the old payout and
   * applying the new one atomically; the host's decision is final.
   */
  resolveMarket(marketId: string, outcome: string, now: number): void {
    const rec = this.rec(marketId);
    const { market, book } = rec;
    this.assertOutcome(market, outcome);
    if (market.state === 'open') this.lockMarket(marketId, now, { quiet: true });
    if (market.state === 'locked') {
      const risk = new Map<string, number>();
      for (const p of participants(market, book, this.offersOf(marketId))) risk.set(p, this.atRiskOf(rec, p));
      const credits = resolveDistribution(market, book, outcome, this.ledger.escrowOf(marketId), this.houseKey);
      const delta = this.settle(rec, credits, now, `resolved: ${outcome}`);
      market.state = 'resolved';
      market.outcome = outcome;
      market.resolvedAt = new Date(now).toISOString();
      market.disputeEndsAt = new Date(now + this.scaled(this.config.disputeSecs * 1000)).toISOString();
      this.afterResolve(rec, risk, delta, now);
      return;
    }
    if (market.state === 'resolved' || market.state === 'disputed') {
      if (market.outcome !== outcome) {
        const from = market.outcome;
        // The book still describes the positions as they were at lock; only `applied` changes.
        const credits = this.distributionAfterSettle(rec, (b) => resolveDistribution(market, b, outcome, this.originalEscrow(book), this.houseKey));
        this.settle(rec, credits, now, `result changed: ${from} -> ${outcome}`);
        market.outcome = outcome;
        this.misc.recentResults = this.misc.recentResults.filter((r) => r.question !== market.question);
        this.pushResult(market);
        const winners = credits
          .filter((c) => c.member !== this.houseKey && c.amount > 0)
          .map((c) => ({ name: this.nameOf(c.member), amount: c.amount }))
          .sort((a, b) => b.amount - a.amount);
        this.fx({
          t: 'announce',
          event: { type: 'market_resolved', market: structuredClone(market), outcomeLabel: this.outcomeLabel(market, outcome), winners, losers: [] },
        });
      }
      this.makeFinal(rec);
      this.refreshScore(marketId);
      return;
    }
    throw new EngineError('market_closed', 'This market can no longer be resolved');
  }

  /** The escrow a settled market held at lock = everything that was paid out of it. */
  private originalEscrow(book: Book): number {
    return sum(Object.values(book.applied ?? {}));
  }

  /** Compute a distribution for an already-settled market (positionsOf/atRisk treat it as settled, the math does not). */
  private distributionAfterSettle(rec: MarketRec, fn: (book: Book) => Credit[]): Credit[] {
    return fn({ ...rec.book, applied: null });
  }

  private pushResult(market: Market): void {
    this.misc.recentResults.push({ question: market.question, outcome: this.outcomeLabel(market, market.outcome ?? '') });
    if (this.misc.recentResults.length > 5) this.misc.recentResults = this.misc.recentResults.slice(-5);
    this.dirty.party = true;
  }

  private afterResolve(rec: MarketRec, risk: Map<string, number>, delta: Map<string, number>, now: number): void {
    const { market } = rec;
    const outcome = market.outcome!;
    const winners: { name: string; amount: number }[] = [];
    const losers: { name: string; amount: number }[] = [];
    for (const [player, staked] of risk) {
      if (player === this.houseKey) continue;
      const got = delta.get(player) ?? 0;
      const net = got - staked;
      const info = this.members.get(player);
      if (net > 0) {
        winners.push({ name: this.nameOf(player), amount: got });
        if (info) info.streak = info.streak > 0 ? info.streak + 1 : 1;
        this.addFill(market, player, 'payout', outcome, got, now);
      } else if (net < 0) {
        losers.push({ name: this.nameOf(player), amount: -net });
        if (info) info.streak = info.streak < 0 ? info.streak - 1 : -1;
        if (got > 0) this.addFill(market, player, 'payout', outcome, got, now);
      } else if (got > 0) {
        this.addFill(market, player, 'refund', outcome, got, now);
      }
      if (info) this.dirty.members.add(player);
      const swing = Math.abs(net);
      if (swing > (this.misc.biggestSwing?.amount ?? 0)) {
        this.misc.biggestSwing = { name: this.nameOf(player), amount: swing, question: market.question };
      }
    }
    winners.sort((a, b) => b.amount - a.amount);
    losers.sort((a, b) => b.amount - a.amount);
    this.pushResult(market);
    this.touchMarket(market.id);
    this.sendPositions(rec, risk.keys());
    this.refreshScore(market.id);
    this.fx({
      t: 'announce',
      event: { type: 'market_resolved', market: structuredClone(market), outcomeLabel: this.outcomeLabel(market, outcome), winners, losers },
    });
    this.fx({ t: 'led', pattern: winners.length > 0 ? 'win' : 'loss' });
    this.fx({ t: 'leaderboard' });
    this.checkLeader();
  }

  private checkLeader(): void {
    const top = this.players().find((p) => !p.isHouse);
    if (!top || top.pnl <= 0 || top.pubkey === this.misc.leader) return;
    this.misc.leader = top.pubkey;
    this.dirty.party = true;
    this.fx({ t: 'announce', event: { type: 'leaderboard_change', leader: top.name, pnl: top.pnl } });
  }

  private makeFinal(rec: MarketRec): void {
    const { market } = rec;
    market.state = 'final';
    delete market.disputeEndsAt;
    this.touchMarket(market.id);
  }

  /** Dispute window passed without a flag. */
  finalizeMarket(marketId: string): void {
    const rec = this.rec(marketId);
    if (rec.market.state !== 'resolved') throw new EngineError('bad_request', 'Market is not resolved');
    this.makeFinal(rec);
  }

  /** Host: keep the disputed (or resolved) result. */
  confirmResult(marketId: string): void {
    const rec = this.rec(marketId);
    if (rec.market.state !== 'disputed' && rec.market.state !== 'resolved') {
      throw new EngineError('bad_request', 'Nothing to confirm on this market');
    }
    this.makeFinal(rec);
  }

  dispute(player: string, marketId: string, reason: string, now: number): void {
    const info = this.members.get(player);
    if (!info || info.isHouse) throw new EngineError('not_joined', 'Join the party first');
    const { market } = this.rec(marketId);
    if (market.state !== 'resolved' || (market.disputeEndsAt && now > Date.parse(market.disputeEndsAt))) {
      throw new EngineError('market_closed', 'The dispute window for this market has closed');
    }
    market.state = 'disputed';
    market.dispute = { by: player, reason, at: new Date(now).toISOString() };
    delete market.disputeEndsAt;
    this.touchMarket(marketId);
    this.fx({ t: 'note', box: false, message: `${info.name} disputed "${market.question}"${reason ? `: ${reason}` : ''}` });
  }

  /** Void: every stake and trade refunded at cost. Works from any state before `final`. */
  voidMarket(marketId: string, reason: string | undefined, now: number): void {
    const rec = this.rec(marketId);
    const { market, book } = rec;
    if (market.state === 'draft') {
      this.discardDraft(marketId);
      return;
    }
    if (market.state === 'final' || market.state === 'voided' || market.state === 'discarded') {
      throw new EngineError('market_closed', 'This market is already closed');
    }
    const affected = new Set(participants(market, book, this.offersOf(marketId)));
    if (market.state === 'open') this.releaseOffers(rec, now);
    if (book.applied === null) {
      const credits = voidDistribution(market, book, this.ledger.escrowOf(marketId), this.houseKey);
      const delta = this.settle(rec, credits, now, 'voided');
      for (const [player, amount] of delta) {
        if (player !== this.houseKey && amount > 0) this.addFill(market, player, 'refund', market.outcomes[0]!.id, amount, now);
      }
    } else {
      const credits = this.distributionAfterSettle(rec, (b) => voidDistribution(market, b, this.originalEscrow(book), this.houseKey));
      this.settle(rec, credits, now, 'voided after resolution');
    }
    market.state = 'voided';
    if (reason) market.voidReason = reason;
    delete market.outcome;
    delete market.disputeEndsAt;
    this.touchMarket(marketId);
    this.sendPositions(rec, affected);
    this.refreshScore(marketId);
    const ev: AnnouncerEvent = { type: 'market_voided', market: structuredClone(market) };
    if (reason) ev.reason = reason;
    this.fx({ t: 'announce', event: ev });
    this.fx({ t: 'leaderboard' });
  }

  /** Time-driven transitions: countdown locks, "last call", dispute windows, draft expiry. */
  tick(now: number): void {
    const lockSoonMs = this.scaled(this.timing.lockSoonSecs * 1000);
    for (const rec of [...this.markets.values()]) {
      const { market, book } = rec;
      if (market.state === 'open' && market.lock.at) {
        const at = Date.parse(market.lock.at);
        if (now >= at) {
          this.lockMarket(market.id, now);
        } else if (!book.lockSoonSent && at - now <= lockSoonMs && (book.lockAfterMs ?? 0) > lockSoonMs) {
          book.lockSoonSent = true;
          this.dirty.markets.add(market.id);
          this.fx({ t: 'announce', event: { type: 'lock_soon', market: structuredClone(market), secondsLeft: this.timing.lockSoonSecs } });
          this.fx({ t: 'led', pattern: 'locking' });
        }
      } else if (market.state === 'resolved' && market.disputeEndsAt && now >= Date.parse(market.disputeEndsAt)) {
        this.makeFinal(rec);
      }
    }
    for (const d of [...this.drafts.values()]) {
      if (now >= Date.parse(d.expiresAt)) this.removeDraft(d.id);
    }
  }

  // ───────────────────────── draft bets (voice) ─────────────────────────

  /** A voice/agent draft. Never moves money: the player must confirm it. */
  addDraft(player: string, marketId: string, outcomeIn: string, amount: number, source: 'voice' | 'host', now: number): DraftBet {
    const info = this.members.get(player);
    if (!info || info.isHouse) throw new EngineError('not_joined', 'That player is not in this party');
    const { market } = this.rec(marketId);
    if (market.state !== 'open') throw new EngineError('market_closed', 'That market is not open');
    const want = outcomeIn.trim().toLowerCase();
    const outcome = market.outcomes.find((o) => o.id.toLowerCase() === want || o.label.toLowerCase() === want);
    if (!outcome) throw new EngineError('bad_request', 'Unknown outcome');
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new EngineError('bad_request', 'Invalid amount');
    const draft: DraftBet = {
      id: `d_${randomId(5)}`,
      player,
      marketId,
      outcome: outcome.id,
      amount,
      source,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.scaled(this.timing.draftTtlMs)).toISOString(),
    };
    this.drafts.set(draft.id, draft);
    this.dirty.drafts.add(draft.id);
    this.fx({ t: 'draft', draft });
    return draft;
  }

  private removeDraft(draftId: string): void {
    const d = this.drafts.get(draftId);
    if (!d) return;
    this.drafts.delete(draftId);
    this.dirty.drafts.add(draftId);
    this.fx({ t: 'draft_removed', member: d.player, draftId });
  }

  private ownDraft(player: string, draftId: string): DraftBet {
    const d = this.drafts.get(draftId);
    if (!d || d.player !== player) throw new EngineError('not_found', 'No such draft');
    return d;
  }

  confirmDraft(player: string, draftId: string, now: number): Record<string, unknown> {
    const d = this.ownDraft(player, draftId);
    if (now >= Date.parse(d.expiresAt)) {
      this.removeDraft(draftId);
      throw new EngineError('market_closed', 'That draft expired');
    }
    const res = this.placeBet(player, d.marketId, d.outcome, d.amount, now);
    this.removeDraft(draftId);
    return res;
  }

  rejectDraft(player: string, draftId: string): void {
    this.ownDraft(player, draftId);
    this.removeDraft(draftId);
  }

  draftsFor(player: string): DraftBet[] {
    return [...this.drafts.values()].filter((d) => d.player === player);
  }
}
