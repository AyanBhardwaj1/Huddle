export type Env = Record<string, string | undefined>;

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
}

export const consoleLogger: Logger = {
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
};

export const silentLogger: Logger = { info: () => {}, warn: () => {} };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Resolve `fetch` at call time so tests can stub the global. */
export function resolveFetch(f?: FetchLike): FetchLike {
  return f ?? ((input, init) => globalThis.fetch(input, init));
}

/** Remove anything that looks like a credential before a string reaches a log line. */
export function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join('[redacted]');
  }
  return out;
}

export function envNumber(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
