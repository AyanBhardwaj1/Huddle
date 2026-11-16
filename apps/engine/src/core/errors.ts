import type { ErrorCode } from '@huddle/shared';

/** A request the engine refuses. Becomes `ack {ok: false, error}` or an HTTP 4xx. */
export class EngineError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

/** A broken money invariant. Never expected; always a bug. The mutation that caused it is not applied. */
export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantError';
  }
}
