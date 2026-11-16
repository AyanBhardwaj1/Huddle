import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  AnnouncerLine,
  BalanceState,
  BetOffer,
  DraftBet,
  Fill,
  GameState,
  GeminiPanel,
  LedgerEntry,
  Party,
  ScorecardEntry,
} from '@huddle/shared';
import type { Book } from './core/book';
import type { StateRecord } from './core/ledger';
import type { CoreMisc, CoreSnapshot, Dirty, MemberInfo, PartyCore } from './core/party-core';

/**
 * SQLite persistence (PRD section 13: "engine restarts without losing state", WAL).
 * One file in DATA_DIR. Every engine action is written in a single transaction after it is applied
 * in memory. No secrets are stored here: keys live in DATA_DIR/keys (see keys.ts).
 */

/** Everything outside the core that must survive a restart. */
export interface RuntimeState {
  game: GameState;
  lastSeq: number;
  /** Replay position (ms at 1x) and speed, so the feed reopens paused where it was. */
  positionMs: number;
  speed: number;
  gemini: GeminiPanel;
  announcer: AnnouncerLine[];
  misc: CoreMisc;
  /** End-of-game progress. */
  recapSent?: boolean;
  hostRefund?: number;
  /** Members whose final state has been submitted to the vault. */
  submitted?: string[];
}

export interface PersistedParty {
  party: Party;
  hostTokenHash: string;
  runtime: RuntimeState;
  core: CoreSnapshot;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  json TEXT NOT NULL,
  host_token_hash TEXT NOT NULL,
  runtime_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  party_id TEXT NOT NULL,
  pubkey TEXT NOT NULL,
  balance INTEGER NOT NULL,
  deposited INTEGER NOT NULL,
  nonce INTEGER NOT NULL,
  state_hash TEXT NOT NULL,
  entry_seq INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (party_id, pubkey)
);
CREATE TABLE IF NOT EXISTS markets (
  party_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  state TEXT NOT NULL,
  escrow INTEGER NOT NULL,
  json TEXT NOT NULL,
  book_json TEXT NOT NULL,
  PRIMARY KEY (party_id, id)
);
CREATE TABLE IF NOT EXISTS positions (
  party_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  player TEXT NOT NULL,
  outcome TEXT NOT NULL,
  stake INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (party_id, market_id, player, outcome)
);
CREATE TABLE IF NOT EXISTS offers (
  party_id TEXT NOT NULL,
  id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (party_id, id)
);
CREATE TABLE IF NOT EXISTS fills (
  party_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  market_id TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (party_id, seq)
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  party_id TEXT NOT NULL,
  member TEXT NOT NULL,
  seq INTEGER NOT NULL,
  nonce INTEGER NOT NULL,
  type TEXT NOT NULL,
  market_id TEXT,
  amount INTEGER NOT NULL,
  memo TEXT,
  PRIMARY KEY (party_id, member, seq)
);
CREATE TABLE IF NOT EXISTS balance_states (
  party_id TEXT NOT NULL,
  member TEXT NOT NULL,
  nonce INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  prev_balance INTEGER NOT NULL,
  state_hash TEXT NOT NULL,
  prev_state_hash TEXT NOT NULL,
  box_sig TEXT NOT NULL,
  member_sig TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (party_id, member, nonce)
);
CREATE TABLE IF NOT EXISTS scorecard_entries (
  party_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (party_id, market_id)
);
CREATE TABLE IF NOT EXISTS drafts (
  party_id TEXT NOT NULL,
  id TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (party_id, id)
);
CREATE TABLE IF NOT EXISTS deposits (
  party_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  member TEXT NOT NULL,
  amount INTEGER NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (party_id, signature)
);
`;

type Row = Record<string, unknown>;

export class Store {
  private readonly db: Database.Database;
  readonly file: string;

  constructor(dataDir: string | ':memory:') {
    if (dataDir === ':memory:') {
      this.file = ':memory:';
    } else {
      fs.mkdirSync(dataDir, { recursive: true });
      this.file = path.join(dataDir, 'huddle.sqlite');
    }
    this.db = new Database(this.file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(SCHEMA);
    this.persist = this.db.transaction(this.persistNow.bind(this));
  }

  close(): void {
    this.db.close();
  }

  /** Write everything an action changed, atomically. */
  readonly persist: (core: PartyCore, dirty: Dirty, hostTokenHash: string, runtime: RuntimeState | null) => void;

  private persistNow(core: PartyCore, dirty: Dirty, hostTokenHash: string, runtime: RuntimeState | null): void {
    const pid = core.party.id;
    const db = this.db;
    if (runtime) {
      db.prepare(
        `INSERT INTO parties (id, code, status, created_at, json, host_token_hash, runtime_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, json = excluded.json, runtime_json = excluded.runtime_json`,
      ).run(pid, core.party.code, core.party.status, core.party.createdAt, JSON.stringify(core.party), hostTokenHash, JSON.stringify(runtime));
    }
    if (dirty.members.size) {
      const stmt = db.prepare(
        `INSERT INTO members (party_id, pubkey, balance, deposited, nonce, state_hash, entry_seq, json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(party_id, pubkey) DO UPDATE SET balance = excluded.balance, deposited = excluded.deposited,
           nonce = excluded.nonce, state_hash = excluded.state_hash, entry_seq = excluded.entry_seq, json = excluded.json`,
      );
      for (const pubkey of dirty.members) {
        const info = core.members.get(pubkey);
        const acct = core.ledger.accounts.get(pubkey);
        if (!info || !acct) continue;
        stmt.run(pid, pubkey, acct.balance, acct.deposited, acct.nonce, acct.stateHash, acct.entrySeq, JSON.stringify(info));
      }
    }
    if (dirty.markets.size) {
      const order = [...core.markets.keys()];
      const upsert = db.prepare(
        `INSERT INTO markets (party_id, id, ord, state, escrow, json, book_json) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(party_id, id) DO UPDATE SET state = excluded.state, escrow = excluded.escrow,
           json = excluded.json, book_json = excluded.book_json`,
      );
      const delPos = db.prepare(`DELETE FROM positions WHERE party_id = ? AND market_id = ?`);
      const insPos = db.prepare(
        `INSERT OR REPLACE INTO positions (party_id, market_id, player, outcome, stake, json) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const id of dirty.markets) {
        const rec = core.markets.get(id);
        if (!rec) continue;
        upsert.run(pid, id, order.indexOf(id), rec.market.state, core.ledger.escrowOf(id), JSON.stringify(rec.market), JSON.stringify(rec.book));
        delPos.run(pid, id);
        for (const p of core.allPositions(id)) insPos.run(pid, id, p.player, p.outcome, p.stake, JSON.stringify(p));
      }
    }
    if (dirty.offers.size) {
      const stmt = db.prepare(
        `INSERT INTO offers (party_id, id, market_id, json) VALUES (?, ?, ?, ?)
         ON CONFLICT(party_id, id) DO UPDATE SET json = excluded.json`,
      );
      for (const id of dirty.offers) {
        const o = core.offers.get(id);
        if (o) stmt.run(pid, id, o.marketId, JSON.stringify(o));
      }
    }
    if (dirty.fills.length) {
      const stmt = db.prepare(`INSERT OR REPLACE INTO fills (party_id, seq, market_id, json) VALUES (?, ?, ?, ?)`);
      for (const f of dirty.fills) stmt.run(pid, Number(f.id.slice(1)), f.marketId, JSON.stringify(f));
    }
    if (dirty.states.length) {
      const insState = db.prepare(
        `INSERT OR REPLACE INTO balance_states
           (party_id, member, nonce, balance, prev_balance, state_hash, prev_state_hash, box_sig, member_sig, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insEntry = db.prepare(
        `INSERT OR REPLACE INTO ledger_entries (party_id, member, seq, nonce, type, market_id, amount, memo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const { state: s, createdAt } of dirty.states) {
        insState.run(pid, s.member, s.nonce, s.balance, s.prevBalance, s.stateHash, s.prevStateHash, s.boxSig, s.memberSig ?? null, createdAt);
        for (const e of s.entries) insEntry.run(pid, s.member, e.seq, s.nonce, e.type, e.marketId ?? null, e.amount, e.memo ?? null);
      }
    }
    if (dirty.cosigns.length) {
      const stmt = db.prepare(`UPDATE balance_states SET member_sig = ? WHERE party_id = ? AND member = ? AND nonce = ?`);
      for (const c of dirty.cosigns) stmt.run(c.memberSig, pid, c.member, c.nonce);
    }
    if (dirty.scorecard.size) {
      const up = db.prepare(
        `INSERT INTO scorecard_entries (party_id, market_id, json) VALUES (?, ?, ?)
         ON CONFLICT(party_id, market_id) DO UPDATE SET json = excluded.json`,
      );
      const del = db.prepare(`DELETE FROM scorecard_entries WHERE party_id = ? AND market_id = ?`);
      for (const id of dirty.scorecard) {
        const e = core.scoreEntries.get(id);
        if (e) up.run(pid, id, JSON.stringify(e));
        else del.run(pid, id);
      }
    }
    if (dirty.drafts.size) {
      const up = db.prepare(
        `INSERT INTO drafts (party_id, id, json) VALUES (?, ?, ?) ON CONFLICT(party_id, id) DO UPDATE SET json = excluded.json`,
      );
      const del = db.prepare(`DELETE FROM drafts WHERE party_id = ? AND id = ?`);
      for (const id of dirty.drafts) {
        const d = core.drafts.get(id);
        if (d) up.run(pid, id, JSON.stringify(d));
        else del.run(pid, id);
      }
    }
    if (dirty.deposits.length) {
      const stmt = db.prepare(`INSERT OR IGNORE INTO deposits (party_id, signature, member, amount, at) VALUES (?, ?, ?, ?, ?)`);
      for (const d of dirty.deposits) stmt.run(pid, d.signature, d.member, d.amount, d.at);
    }
  }

  /**
   * Every party that was not finalized when the engine stopped, plus recently finalized ones
   * (created after `finalizedSince`, ms epoch) so their results stay readable. Oldest first.
   */
  loadAll(finalizedSince: number): PersistedParty[] {
    const rows = this.db
      .prepare(`SELECT * FROM parties WHERE status != 'finalized' OR created_at >= ? ORDER BY created_at`)
      .all(new Date(finalizedSince).toISOString()) as Row[];
    return rows.map((r) => this.loadParty(r));
  }

  codeExists(code: string): boolean {
    return this.db.prepare(`SELECT 1 FROM parties WHERE code = ?`).get(code) !== undefined;
  }

  private loadParty(row: Row): PersistedParty {
    const pid = row.id as string;
    const db = this.db;
    const all = (sql: string): Row[] => db.prepare(sql).all(pid) as Row[];

    const entriesByState = new Map<string, LedgerEntry[]>();
    for (const e of all(`SELECT * FROM ledger_entries WHERE party_id = ? ORDER BY member, seq`)) {
      const key = `${e.member as string}:${e.nonce as number}`;
      const entry: LedgerEntry = { seq: e.seq as number, type: e.type as LedgerEntry['type'], amount: e.amount as number };
      if (e.market_id !== null) entry.marketId = e.market_id as string;
      if (e.memo !== null) entry.memo = e.memo as string;
      const list = entriesByState.get(key) ?? [];
      list.push(entry);
      entriesByState.set(key, list);
    }
    const states = new Map<string, StateRecord[]>();
    for (const s of all(`SELECT * FROM balance_states WHERE party_id = ? ORDER BY member, nonce`)) {
      const member = s.member as string;
      const state: BalanceState = {
        member,
        nonce: s.nonce as number,
        balance: s.balance as number,
        prevBalance: s.prev_balance as number,
        stateHash: s.state_hash as string,
        prevStateHash: s.prev_state_hash as string,
        entries: entriesByState.get(`${member}:${s.nonce as number}`) ?? [],
        boxSig: s.box_sig as string,
      };
      if (s.member_sig !== null) state.memberSig = s.member_sig as string;
      const list = states.get(member) ?? [];
      list.push({ state, createdAt: s.created_at as number });
      states.set(member, list);
    }
    const runtime = JSON.parse(row.runtime_json as string) as RuntimeState;
    const core: CoreSnapshot = {
      members: all(`SELECT * FROM members WHERE party_id = ?`).map((m) => ({
        info: JSON.parse(m.json as string) as MemberInfo,
        account: {
          balance: m.balance as number,
          deposited: m.deposited as number,
          nonce: m.nonce as number,
          stateHash: m.state_hash as string,
          entrySeq: m.entry_seq as number,
        },
      })),
      states,
      markets: all(`SELECT * FROM markets WHERE party_id = ? ORDER BY ord`).map((m) => ({
        rec: { market: JSON.parse(m.json as string), book: JSON.parse(m.book_json as string) as Book },
        escrow: m.escrow as number,
      })),
      offers: all(`SELECT json FROM offers WHERE party_id = ?`).map((o) => JSON.parse(o.json as string) as BetOffer),
      fills: all(`SELECT json FROM (SELECT * FROM fills WHERE party_id = ? ORDER BY seq DESC LIMIT 50) ORDER BY seq`).map(
        (f) => JSON.parse(f.json as string) as Fill,
      ),
      scorecard: all(`SELECT json FROM scorecard_entries WHERE party_id = ?`).map((e) => JSON.parse(e.json as string) as ScorecardEntry),
      drafts: all(`SELECT json FROM drafts WHERE party_id = ?`).map((d) => JSON.parse(d.json as string) as DraftBet),
      deposits: all(`SELECT signature FROM deposits WHERE party_id = ?`).map((d) => d.signature as string),
      misc: runtime.misc,
    };
    return {
      party: JSON.parse(row.json as string) as Party,
      hostTokenHash: row.host_token_hash as string,
      runtime,
      core,
    };
  }

  /** Raw counts, for tests and debugging. */
  count(table: 'parties' | 'members' | 'markets' | 'positions' | 'offers' | 'fills' | 'ledger_entries' | 'balance_states' | 'scorecard_entries' | 'drafts' | 'deposits'): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  }
}
