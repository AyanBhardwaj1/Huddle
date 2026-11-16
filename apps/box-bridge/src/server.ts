import { bridgeCommandSchema, type BridgeEvent } from '@huddle/shared';
import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { HardwareAdapter } from './hardware';

export interface BridgeServer {
  /** Port actually bound (useful with port 0). */
  readonly port: number;
  /** Number of connected clients. */
  readonly clients: number;
  /** Send an event to every connected client. */
  broadcast(e: BridgeEvent): void;
  close(): Promise<void>;
}

export interface BridgeServerOptions {
  port: number;
  /**
   * Bind address. Default: loopback only, on BOTH 127.0.0.1 and ::1 (when available), so
   * `ws://localhost:7777` works whichever way `localhost` resolves (Node prefers ::1 on macOS).
   */
  host?: string;
  hardware: HardwareAdapter;
  log?: (line: string) => void;
}

/**
 * PRD section 10 bridge contract over WebSocket:
 *  - on connect: `bridge_status` with the hardware capabilities
 *  - hardware button edges are broadcast to ALL clients as `button` events
 *  - `led` / `nfc_set_url` commands from any client are validated with `bridgeCommandSchema`;
 *    invalid frames are ignored; `nfc_set_url` is answered with `nfc_written` (to the sender)
 */
export function startBridgeServer(opts: BridgeServerOptions): Promise<BridgeServer> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const hw = opts.hardware;
  const wss = new WebSocketServer({ noServer: true });
  const httpServers: Server[] = [];
  const sockets = new Set<WebSocket>();

  const send = (ws: WebSocket, e: BridgeEvent) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(e));
  };
  const broadcast = (e: BridgeEvent) => {
    for (const ws of sockets) send(ws, e);
  };

  const offButton = hw.onButton((id, action) => {
    log(`[btn] ${id.toUpperCase()} ${action}  -> ${sockets.size} client(s)`);
    broadcast({ type: 'button', id, action });
  });

  wss.on('connection', (ws) => {
    sockets.add(ws);
    log(`[ws] client connected (${sockets.size})`);
    send(ws, { type: 'bridge_status', ...hw.capabilities });

    ws.on('message', (raw) => {
      let json: unknown;
      try {
        json = JSON.parse(String(raw));
      } catch {
        return;
      }
      const parsed = bridgeCommandSchema.safeParse(json);
      if (!parsed.success) {
        log(`[ws] ignored invalid command ${String(raw).slice(0, 80)}`);
        return;
      }
      const cmd = parsed.data;
      if (cmd.type === 'led') {
        void hw.setLeds(cmd.pattern, cmd.color);
      } else {
        void hw.writeNfc(cmd.url).then((ok) => {
          if (ok) send(ws, { type: 'nfc_written', url: cmd.url });
          else log(`[nfc] write failed for ${cmd.url}`);
        });
      }
    });
    ws.on('close', () => {
      sockets.delete(ws);
      log(`[ws] client disconnected (${sockets.size})`);
    });
    ws.on('error', () => {
      /* close follows */
    });
  });

  const listen = (host: string, port: number) =>
    new Promise<Server>((resolve, reject) => {
      const srv = createServer((_req, res) => {
        res.writeHead(426, { 'content-type': 'text/plain' });
        res.end('huddle box-bridge: WebSocket only');
      });
      srv.on('upgrade', (req, socket, head) => {
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      });
      srv.once('error', reject);
      srv.listen(port, host, () => {
        srv.off('error', reject);
        resolve(srv);
      });
    });

  const start = async (): Promise<BridgeServer> => {
    const hosts = opts.host ? [opts.host] : ['127.0.0.1', '::1'];
    const first = await listen(hosts[0]!, opts.port);
    httpServers.push(first);
    const addr = first.address();
    const port = typeof addr === 'object' && addr ? addr.port : opts.port;
    for (const h of hosts.slice(1)) {
      try {
        httpServers.push(await listen(h, port));
      } catch {
        /* e.g. IPv6 disabled: IPv4 loopback is enough */
      }
    }
    return {
      port,
      get clients() {
        return sockets.size;
      },
      broadcast,
      close: async () => {
        offButton();
        for (const ws of sockets) ws.terminate();
        await new Promise<void>((done) => wss.close(() => done()));
        await Promise.all(httpServers.map((srv) => new Promise<void>((done) => srv.close(() => done()))));
        await hw.close?.();
      },
    };
  };
  return start();
}
