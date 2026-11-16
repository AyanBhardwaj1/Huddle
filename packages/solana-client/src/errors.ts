/** huddle_vault custom errors (Anchor: 6000 + index in `VaultError`, programs/huddle_vault/src/error.rs). */
export const VAULT_ERRORS = [
  'PartyNotOpen',
  'PartyNotClosing',
  'PartyNotFinalized',
  'ChallengeWindowOpen',
  'ChallengeTooLong',
  'ZeroAmount',
  'NotAuthorizedToClose',
  'MemberCloseTooEarly',
  'MissingBoxSignature',
  'MissingMemberSignature',
  'MalformedEd25519Instruction',
  'StaleNonce',
  'AlreadyWithdrawn',
  'NothingToWithdraw',
  'MathOverflow',
] as const;
export type VaultErrorName = (typeof VAULT_ERRORS)[number];

export const VAULT_ERROR_BASE = 6000;

/** Messages match `MockSettlementClient` where the mock has the same failure. */
const MESSAGES: Record<VaultErrorName, string> = {
  PartyNotOpen: 'party is not open',
  PartyNotClosing: 'party is not closing',
  PartyNotFinalized: 'party is not finalized',
  ChallengeWindowOpen: 'challenge window still open',
  ChallengeTooLong: 'challenge window is too long',
  ZeroAmount: 'amount must be greater than zero',
  NotAuthorizedToClose: 'only the host or the box can close',
  MemberCloseTooEarly: 'members can only close after the 6 hour timeout',
  MissingBoxSignature: 'invalid box signature',
  MissingMemberSignature: 'invalid member signature',
  MalformedEd25519Instruction: 'malformed ed25519 instruction',
  StaleNonce: 'stale nonce',
  AlreadyWithdrawn: 'already withdrawn',
  NothingToWithdraw: 'nothing to withdraw',
  MathOverflow: 'math overflow',
};

export function vaultErrorName(code: number): VaultErrorName | undefined {
  return VAULT_ERRORS[code - VAULT_ERROR_BASE];
}

/** A failed huddle_vault transaction, with the decoded program error when there is one. */
export class VaultTxError extends Error {
  constructor(
    message: string,
    readonly code?: VaultErrorName,
    readonly signature?: string,
    readonly logs?: string[],
    readonly original?: unknown,
  ) {
    super(message);
    this.name = 'VaultTxError';
  }
}

function customCodeOf(err: unknown): number | undefined {
  // Confirmed-with-error shape: { InstructionError: [index, { Custom: 6003 }] }
  if (err && typeof err === 'object' && 'InstructionError' in err) {
    const inner = (err as { InstructionError: [number, unknown] }).InstructionError[1];
    if (inner && typeof inner === 'object' && 'Custom' in inner) return Number((inner as { Custom: number }).Custom);
  }
  // Preflight failure: "... custom program error: 0x1773" in the message or the logs.
  const logs = (err as { logs?: unknown } | null)?.logs;
  const text = [err instanceof Error ? err.message : JSON.stringify(err), ...(Array.isArray(logs) ? (logs as string[]) : [])].join('\n');
  const m = /custom program error: 0x([0-9a-fA-F]+)/.exec(text);
  return m ? parseInt(m[1] as string, 16) : undefined;
}

export function toVaultError(err: unknown, signature?: string): VaultTxError {
  if (err instanceof VaultTxError) return err;
  const logsRaw = (err as { logs?: unknown } | null)?.logs;
  const logs = Array.isArray(logsRaw) ? (logsRaw as string[]) : undefined;
  const code = customCodeOf(err);
  const name = code === undefined ? undefined : vaultErrorName(code);
  if (name) return new VaultTxError(MESSAGES[name], name, signature, logs, err);
  if (code === 1) return new VaultTxError('insufficient USDC balance', undefined, signature, logs, err);
  const base = err instanceof Error ? err.message : JSON.stringify(err);
  if (/block height exceeded|blockhash not found|expired/i.test(base)) {
    return new VaultTxError('transaction expired before it was confirmed, try again', undefined, signature, logs, err);
  }
  return new VaultTxError(`transaction failed: ${base}`, undefined, signature, logs, err);
}
