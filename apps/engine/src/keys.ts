import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPair, keyPairFromSecret, parseSecretKey, type KeyPair } from '@huddle/shared';

/**
 * Engine-held keys. They live in DATA_DIR/keys (dir 700, files 600), never in SQLite and never in
 * logs. With no DATA_DIR (tests) they stay in memory.
 *  - box signer: signs every balance state (BOX_SIGNER_SECRET_KEY, or generated once and kept).
 *  - house keys: one per party; the host/house account that funds the market maker (D4).
 *  - session secret: HMAC key for agent session tokens when AGENT_TOOLS_SECRET is not set.
 */
export class KeyStore {
  private readonly dir: string | null;
  private readonly mem = new Map<string, Uint8Array>();

  constructor(dataDir: string | null) {
    this.dir = dataDir ? path.join(dataDir, 'keys') : null;
    if (this.dir) fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  private read(name: string): Uint8Array | null {
    if (!this.dir) return this.mem.get(name) ?? null;
    const file = path.join(this.dir, name);
    if (!fs.existsSync(file)) return null;
    return Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8')) as number[]);
  }

  private write(name: string, bytes: Uint8Array): void {
    if (!this.dir) {
      this.mem.set(name, bytes);
      return;
    }
    const file = path.join(this.dir, name);
    fs.writeFileSync(file, JSON.stringify(Array.from(bytes)), { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  }

  /** The box signer: from the environment when given, else generated once and persisted. */
  boxSigner(envSecret?: string): KeyPair {
    if (envSecret && envSecret.trim()) return keyPairFromSecret(parseSecretKey(envSecret));
    const existing = this.read('box-signer.json');
    if (existing) return keyPairFromSecret(existing);
    const kp = generateKeyPair();
    this.write('box-signer.json', kp.secretKey);
    return kp;
  }

  createHouseKey(partyId: string): KeyPair {
    const kp = generateKeyPair();
    this.write(`house-${partyId}.json`, kp.secretKey);
    return kp;
  }

  houseKey(partyId: string): KeyPair | null {
    const bytes = this.read(`house-${partyId}.json`);
    return bytes ? keyPairFromSecret(bytes) : null;
  }

  sessionSecret(): Uint8Array {
    const existing = this.read('session-secret.json');
    if (existing) return existing;
    const bytes = new Uint8Array(crypto.randomBytes(32));
    this.write('session-secret.json', bytes);
    return bytes;
  }
}

export function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('hex');
}
