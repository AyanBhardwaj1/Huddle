import { z } from 'zod';

/** Box bridge contract (PRD section 10). WebSocket at ws://localhost:7777, JSON messages. */

export const LED_PATTERNS = [
  'idle',
  'join',
  'market_open',
  'locking',
  'locked',
  'win',
  'loss',
  'goal',
  'error',
] as const;
export type LedPattern = (typeof LED_PATTERNS)[number];

export const BUTTON_IDS = ['lock', 'talk', 'next'] as const;
export type ButtonId = (typeof BUTTON_IDS)[number];

export const DEFAULT_LED_COLORS: Record<LedPattern, string> = {
  idle: '#1E90FF',
  join: '#00E5A0',
  market_open: '#FFD60A',
  locking: '#FF9F0A',
  locked: '#FF453A',
  win: '#30D158',
  loss: '#FF375F',
  goal: '#FFFFFF',
  error: '#FF0000',
};

// Bridge -> software
export const bridgeEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('button'), id: z.enum(BUTTON_IDS), action: z.enum(['down', 'up']) }),
  z.object({ type: z.literal('nfc_written'), url: z.string() }),
  z.object({ type: z.literal('bridge_status'), leds: z.boolean(), nfc: z.boolean(), buttons: z.boolean() }),
]);
export type BridgeEvent = z.infer<typeof bridgeEventSchema>;

// Software -> bridge
export const bridgeCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('led'),
    pattern: z.enum(LED_PATTERNS),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  z.object({ type: z.literal('nfc_set_url'), url: z.string().url() }),
]);
export type BridgeCommand = z.infer<typeof bridgeCommandSchema>;

export const BRIDGE_DEFAULT_URL = 'ws://localhost:7777';
