import type { ButtonId, LedPattern } from '@huddle/shared';
import { ledPreview } from './ledPreview';

/**
 * ============================================================================
 *  HARDWARE ADAPTER — the hardware engineer implements `PiHardware` below.
 * ============================================================================
 *
 * The bridge server (server.ts) speaks the PRD section 10 WebSocket contract and calls this
 * interface. Nothing else in the software stack talks to GPIO / LEDs / NFC directly.
 *
 *   setLeds(pattern, color)  drive the WS2812 ring: play `pattern` (see LED_PATTERNS) in `color`.
 *                            Patterns should loop until the next call, except one-shot ones
 *                            (join, win, loss, goal) which play once then fall back to `idle`.
 *   writeNfc(url)            write an NDEF URI record to the PN532 tag; resolve true on success.
 *   onButton(cb)             call cb('lock' | 'talk' | 'next', 'down' | 'up') on every edge
 *                            (debounced ~20 ms). TALK is push-to-talk, so both edges matter.
 *   capabilities             what is actually fitted; sent to clients as `bridge_status`.
 */
export interface HardwareAdapter {
  readonly name: string;
  readonly capabilities: { leds: boolean; nfc: boolean; buttons: boolean };
  setLeds(pattern: LedPattern, color: string): void | Promise<void>;
  writeNfc(url: string): Promise<boolean>;
  onButton(cb: (id: ButtonId, action: 'down' | 'up') => void): () => void;
  close?(): void | Promise<void>;
}

type ButtonCb = (id: ButtonId, action: 'down' | 'up') => void;

/** Mock hardware: LED commands print a truecolor ring preview; buttons come from `press()` (keyboard). */
export class MockHardware implements HardwareAdapter {
  readonly name = 'mock';
  readonly capabilities = { leds: true, nfc: false, buttons: true };
  private cbs = new Set<ButtonCb>();

  constructor(private readonly log: (line: string) => void = (l) => console.log(l)) {}

  setLeds(pattern: LedPattern, color: string): void {
    this.log(ledPreview(pattern, color));
  }

  async writeNfc(url: string): Promise<boolean> {
    this.log(`[nfc] (mock) would write ${url}`);
    return true;
  }

  onButton(cb: ButtonCb): () => void {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }

  /** Simulate a physical button edge. */
  press(id: ButtonId, action: 'down' | 'up'): void {
    for (const cb of this.cbs) cb(id, action);
  }
}

/**
 * Raspberry Pi 5 adapter — TODO(hardware): fill in. Suggested libraries:
 *   - buttons: `onoff` or `node-libgpiod` (GPIO edges, pull-ups, ~20 ms debounce)
 *   - LEDs:    `rpi-ws281x-native` / `@gbkwiatt/node-rpi-ws281x-native` (Pi 5 needs the PIO/SPI driver)
 *   - NFC:     `nfc-pn532` over I2C/UART, or leave `nfc: false` and use a passive sticker tag
 * Until it is implemented it reports nothing fitted and logs what it was asked to do,
 * so the software stack still runs on a Pi without the peripherals.
 */
export class PiHardware implements HardwareAdapter {
  readonly name = 'pi';
  // TODO(hardware): flip these to true as each peripheral is implemented.
  readonly capabilities = { leds: false, nfc: false, buttons: false };
  private cbs = new Set<ButtonCb>();

  setLeds(pattern: LedPattern, color: string): void {
    // TODO(hardware): render `pattern` on the WS2812 ring in `color`.
    console.log(`[pi] setLeds(${pattern}, ${color}) — not implemented yet`);
  }

  async writeNfc(url: string): Promise<boolean> {
    // TODO(hardware): write an NDEF URI record via the PN532.
    console.log(`[pi] writeNfc(${url}) — not implemented yet`);
    return false;
  }

  onButton(cb: ButtonCb): () => void {
    // TODO(hardware): watch GPIO pins for LOCK / TALK / NEXT and call cb on each edge.
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }
}
