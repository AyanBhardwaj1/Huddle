import { MockHardware, PiHardware, type HardwareAdapter } from './hardware';
import { attachKeyboard, detachKeyboard } from './keyboard';
import { startBridgeServer } from './server';

/**
 * Huddle box bridge.
 *   tsx src/index.ts --mock   mock hardware: LED preview in the terminal, keys L / T / N = LOCK / TALK / NEXT
 *   tsx src/index.ts          real hardware via PiHardware (see hardware.ts)
 * BRIDGE_PORT overrides the default port 7777; BRIDGE_HOST the bind address (default: loopback, 127.0.0.1 + ::1).
 */
async function main(): Promise<void> {
  const mock = process.argv.includes('--mock');
  const port = Number(process.env.BRIDGE_PORT ?? 7777);
  const host = process.env.BRIDGE_HOST;
  const hardware: HardwareAdapter = mock ? new MockHardware() : new PiHardware();

  const server = await startBridgeServer({ port, host, hardware });
  console.log(`huddle box-bridge (${hardware.name}) listening on ws://${host ?? 'localhost'}:${server.port}`);

  let quitting = false;
  const quit = () => {
    if (quitting) return;
    quitting = true;
    detachKeyboard();
    console.log('bye');
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);

  if (hardware instanceof MockHardware) {
    const tty = attachKeyboard({
      press: (id, action) => hardware.press(id, action),
      quit,
      log: (l) => console.log(l),
    });
    console.log(
      tty
        ? 'keys: L = LOCK   T = TALK (toggle hold)   N = NEXT   Q / Ctrl-C = quit'
        : 'stdin is not a TTY: keyboard buttons disabled (bridge keeps running)',
    );
  }
}

main().catch((e: unknown) => {
  console.error('box-bridge failed to start:', e instanceof Error ? e.message : e);
  process.exit(1);
});
