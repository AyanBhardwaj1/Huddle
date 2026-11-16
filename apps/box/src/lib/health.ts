import type { HealthResponse } from './api';

export type ChipTone = 'ok' | 'info' | 'warn' | 'off';
export interface StatusChip {
  id: string;
  label: string;
  tone: ChipTone;
  /** Longer explanation for a warning chip (PRD section 7 fallbacks: "log a warning on the host screen"). */
  hint?: string;
}

/**
 * Engine provider values are not pinned down by the shared contract. Accept a plain string
 * ("replay", "elevenlabs", "webspeech", "mock") or an object like `{ name, live }` / `{ provider, mode }`.
 */
export function providerName(v: unknown): string | null {
  if (typeof v === 'string') return v.toLowerCase();
  if (typeof v === 'boolean') return v ? 'live' : 'off';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['name', 'provider', 'mode', 'kind', 'source', 'type']) {
      if (typeof o[k] === 'string') return (o[k] as string).toLowerCase();
    }
    if (typeof o.live === 'boolean') return o.live ? 'live' : 'mock';
  }
  return null;
}

const has = (s: string | null, ...needles: string[]) => !!s && needles.some((n) => s.includes(n));

export function healthChips(h: HealthResponse | null, offline = false): StatusChip[] {
  if (offline || !h) {
    return [{ id: 'engine', label: 'Engine offline', tone: 'warn', hint: 'Start the engine on port 8080, then tap retry.' }];
  }
  const chips: StatusChip[] = [{ id: 'engine', label: h.ok ? 'Engine ready' : 'Engine degraded', tone: h.ok ? 'ok' : 'warn' }];

  const sports = providerName(h.providers?.sports);
  if (sports) {
    chips.push(
      has(sports, 'replay', 'mock')
        ? { id: 'sports', label: 'Replay mode', tone: 'info' }
        : { id: 'sports', label: `Live data: ${sports}`, tone: 'ok' },
    );
  }

  const settlement = providerName(h.settlement);
  if (settlement) {
    if (has(settlement, 'point')) chips.push({ id: 'settlement', label: 'Points only', tone: 'info' });
    else if (has(settlement, 'trust')) chips.push({ id: 'settlement', label: 'Trusted host', tone: 'info' });
    else if (has(settlement, 'vault', 'devnet', 'solana')) chips.push({ id: 'settlement', label: 'Vault · test money', tone: 'ok' });
    else chips.push({ id: 'settlement', label: `Settlement: ${settlement}`, tone: 'info' });
  }

  const gemini = providerName(h.providers?.gemini);
  if (gemini) {
    if (has(gemini, 'live')) chips.push({ id: 'gemini', label: 'Gemini: live', tone: 'ok' });
    else if (has(gemini, 'mock')) chips.push({ id: 'gemini', label: 'Gemini: sample prices', tone: 'info' });
    else if (has(gemini, 'none', 'off', 'disabled', 'unavailable')) chips.push({ id: 'gemini', label: 'Gemini: off', tone: 'off' });
    else chips.push({ id: 'gemini', label: `Gemini: ${gemini}`, tone: 'ok' });
  }

  const voice = providerName(h.providers?.announcer);
  if (voice !== null) {
    chips.push(
      has(voice, 'eleven')
        ? { id: 'voice', label: 'Voice: ElevenLabs', tone: 'ok' }
        : {
            id: 'voice',
            label: 'Voice: Web Speech fallback',
            tone: 'warn',
            hint: 'ElevenLabs is not configured (ELEVENLABS_API_KEY). The announcer uses the browser voice.',
          },
    );
  }

  const llm = providerName(h.providers?.llm);
  if (llm) {
    chips.push(
      has(llm, 'mock', 'template', 'none', 'off')
        ? { id: 'llm', label: 'AI lines: templates', tone: 'info' }
        : { id: 'llm', label: `AI: ${llm}`, tone: 'ok' },
    );
  }
  return chips;
}
