import { BRIDGE_DEFAULT_URL, bridgeEventSchema, type BridgeCommand, type BridgeEvent } from './bridge';
import type { BoxBridge } from './interfaces';

/**
 * Reconnecting WebSocket client for the box bridge daemon (real or `--mock`).
 * Works in the browser (box UI) and in Node 22+ (engine). Commands sent while disconnected are
 * dropped except the most recent LED command, which is replayed on reconnect.
 */
export class BridgeClient implements BoxBridge {
  private ws: WebSocket | null = null;
  private listeners = new Set<(e: BridgeEvent) => void>();
  private closed = false;
  private lastLed: BridgeCommand | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string = BRIDGE_DEFAULT_URL,
    private readonly opts: { WebSocketCtor?: typeof WebSocket; retryMs?: number; onStatus?: (connected: boolean) => void } = {},
  ) {
    this.connect();
  }

  get connected(): boolean {
    return this.ws?.readyState === 1;
  }

  private connect(): void {
    if (this.closed) return;
    const Ctor = this.opts.WebSocketCtor ?? globalThis.WebSocket;
    if (!Ctor) return;
    let ws: WebSocket;
    try {
      ws = new Ctor(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.opts.onStatus?.(true);
      if (this.lastLed) ws.send(JSON.stringify(this.lastLed));
    };
    ws.onmessage = (ev: MessageEvent) => {
      try {
        const parsed = bridgeEventSchema.safeParse(JSON.parse(String(ev.data)));
        if (parsed.success) this.listeners.forEach((l) => l(parsed.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      this.opts.onStatus?.(false);
      this.scheduleRetry();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleRetry(): void {
    if (this.closed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.opts.retryMs ?? 2000);
  }

  send(cmd: BridgeCommand): void {
    if (cmd.type === 'led') this.lastLed = cmd;
    if (this.connected) this.ws!.send(JSON.stringify(cmd));
  }

  onEvent(cb: (e: BridgeEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
  }
}
