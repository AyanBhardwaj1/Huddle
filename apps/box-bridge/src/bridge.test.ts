import { bridgeEventSchema, type BridgeEvent } from '@huddle/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { MockHardware } from './hardware';
import { createKeyHandler } from './keyboard';
import { ledPreview } from './ledPreview';
import { startBridgeServer, type BridgeServer } from './server';

type Client = { ws: WebSocket; events: BridgeEvent[]; next: (pred?: (e: BridgeEvent) => boolean) => Promise<BridgeEvent> };

async function connect(port: number): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const events: BridgeEvent[] = [];
  const waiters: { pred: (e: BridgeEvent) => boolean; resolve: (e: BridgeEvent) => void }[] = [];
  ws.on('message', (raw) => {
    const e = bridgeEventSchema.parse(JSON.parse(String(raw)));
    events.push(e);
    for (const w of [...waiters]) {
      if (w.pred(e)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(e);
      }
    }
  });
  await new Promise<void>((res, rej) => {
    ws.once('open', () => res());
    ws.once('error', rej);
  });
  const next = (pred: (e: BridgeEvent) => boolean = () => true) => {
    const seen = events.find(pred);
    if (seen) {
      events.splice(events.indexOf(seen), 1);
      return Promise.resolve(seen);
    }
    return new Promise<BridgeEvent>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for bridge event')), 1000);
      waiters.push({
        pred,
        resolve: (e) => {
          clearTimeout(t);
          events.splice(events.indexOf(e), 1);
          resolve(e);
        },
      });
    });
  };
  return { ws, events, next };
}

describe('box bridge contract', () => {
  let hw: MockHardware;
  let server: BridgeServer;
  let logs: string[];
  const clients: Client[] = [];

  beforeEach(async () => {
    logs = [];
    hw = new MockHardware((l) => logs.push(l));
    server = await startBridgeServer({ port: 0, hardware: hw, log: () => {} });
  });
  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    await server.close();
  });

  it('sends bridge_status on connect', async () => {
    const c = await connect(server.port);
    clients.push(c);
    expect(await c.next()).toEqual({ type: 'bridge_status', leds: true, nfc: false, buttons: true });
  });

  it('broadcasts button events to every client', async () => {
    const a = await connect(server.port);
    const b = await connect(server.port);
    clients.push(a, b);
    await a.next((e) => e.type === 'bridge_status');
    await b.next((e) => e.type === 'bridge_status');
    hw.press('lock', 'down');
    hw.press('lock', 'up');
    for (const c of [a, b]) {
      expect(await c.next((e) => e.type === 'button')).toEqual({ type: 'button', id: 'lock', action: 'down' });
      expect(await c.next((e) => e.type === 'button')).toEqual({ type: 'button', id: 'lock', action: 'up' });
    }
  });

  it('validates LED commands and ignores invalid frames', async () => {
    const setLeds = vi.spyOn(hw, 'setLeds');
    const c = await connect(server.port);
    clients.push(c);
    await c.next((e) => e.type === 'bridge_status');
    c.ws.send('not json');
    c.ws.send(JSON.stringify({ type: 'led', pattern: 'disco', color: '#FFFFFF' }));
    c.ws.send(JSON.stringify({ type: 'led', pattern: 'win', color: 'green' }));
    c.ws.send(JSON.stringify({ type: 'led', pattern: 'goal', color: '#ffffff' }));
    await new Promise((r) => setTimeout(r, 100));
    expect(setLeds).toHaveBeenCalledTimes(1);
    expect(setLeds).toHaveBeenCalledWith('goal', '#ffffff');
    expect(logs.some((l) => l.includes('goal'))).toBe(true);
    expect(server.clients).toBe(1); // still connected after garbage
  });

  it('answers nfc_set_url with nfc_written', async () => {
    const c = await connect(server.port);
    clients.push(c);
    await c.next((e) => e.type === 'bridge_status');
    c.ws.send(JSON.stringify({ type: 'nfc_set_url', url: 'https://huddle.example/j/ABCD' }));
    expect(await c.next((e) => e.type === 'nfc_written')).toEqual({ type: 'nfc_written', url: 'https://huddle.example/j/ABCD' });
    c.ws.send(JSON.stringify({ type: 'nfc_set_url', url: 'not a url' }));
    await expect(c.next((e) => e.type === 'nfc_written')).rejects.toThrow('timeout');
  });
});

describe('keyboard mapping', () => {
  it('L taps lock, T toggles talk, Q quits', async () => {
    const presses: string[] = [];
    let quit = 0;
    const h = createKeyHandler({ press: (id, a) => presses.push(`${id}:${a}`), quit: () => quit++, tapMs: 5 });
    h('L');
    h('t');
    h('t');
    h('q');
    await new Promise((r) => setTimeout(r, 20));
    expect(presses).toEqual(['lock:down', 'talk:down', 'talk:up', 'lock:up']);
    expect(quit).toBe(1);
  });
});

describe('led preview', () => {
  it('renders a truecolor ring with the pattern name', () => {
    const line = ledPreview('market_open', '#FFD60A');
    expect(line).toContain('market_open');
    expect(line).toContain('\x1b[38;2;');
    expect(ledPreview('idle', '#1E90FF', { color: false })).toBe('[led] (●●●●●●●●●●●●) idle        #1E90FF');
  });
});
