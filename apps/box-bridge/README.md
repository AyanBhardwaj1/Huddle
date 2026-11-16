# @huddle/box-bridge

Small local daemon that connects the box hardware (buttons, LED ring, NFC) to the software.
The box UI (`apps/box`) and the engine both connect to it over WebSocket. Contract: PRD section 10,
schemas in `packages/shared/src/bridge.ts`.

## Run

```bash
pnpm --filter @huddle/box-bridge mock     # mock hardware (laptop / demo)
pnpm --filter @huddle/box-bridge start    # real hardware (Raspberry Pi), uses PiHardware
```

| Env | Default | Meaning |
| --- | --- | --- |
| `BRIDGE_PORT` | `7777` | WebSocket port |
| `BRIDGE_HOST` | loopback (`127.0.0.1` and `::1`) | Bind address. Loopback only by default so nobody on the LAN can press buttons. |

### Mock mode (`--mock`)

- Every `led` command prints a ring of truecolor blocks in the command's color plus the pattern name.
- Keyboard (only when stdin is a TTY): `L` = LOCK, `N` = NEXT (tap: `down`, then `up` after 150 ms),
  `T` = TALK (toggle: first press `down`, second press `up`, so you can "hold" it), `Q` / Ctrl-C = quit.
- When stdin is not a TTY (e.g. under `pnpm demo`) the keyboard is skipped and the bridge keeps running.
  The box UI has the same keys (`L`, hold `T`, `N`) and on-screen buttons, so the demo works either way.
- Reports `bridge_status { leds: true, nfc: false, buttons: true }`; `nfc_set_url` is logged and answered with `nfc_written`.

## Contract

WebSocket, JSON text frames.

Bridge to software (broadcast to **all** connected clients):

```json
{"type": "bridge_status", "leds": true, "nfc": false, "buttons": true}   // sent once on connect
{"type": "button", "id": "lock" | "talk" | "next", "action": "down" | "up"}
{"type": "nfc_written", "url": "https://…/j/ABCD"}                        // reply to nfc_set_url (sender only)
```

Software to bridge (from any client; validated with `bridgeCommandSchema`, invalid frames are ignored):

```json
{"type": "led", "pattern": "idle|join|market_open|locking|locked|win|loss|goal|error", "color": "#RRGGBB"}
{"type": "nfc_set_url", "url": "https://…/j/ABCD"}
```

Who listens to what: the **engine** handles the `lock` button and drives the LEDs; the **box UI**
handles `talk` (push-to-talk) and `next` (cycles the host panel / screens) and ignores `lock`.

## For the hardware engineer: what to fill in

Everything hardware-specific lives in `src/hardware.ts`, class `PiHardware`, implementing:

```ts
interface HardwareAdapter {
  capabilities: { leds: boolean; nfc: boolean; buttons: boolean }; // what is fitted -> bridge_status
  setLeds(pattern: LedPattern, color: string): void;               // WS2812 ring
  writeNfc(url: string): Promise<boolean>;                         // PN532 NDEF URI write
  onButton(cb: (id: 'lock' | 'talk' | 'next', action: 'down' | 'up') => void): () => void; // GPIO edges
  close?(): void;
}
```

1. **Buttons**: watch the GPIO pins for LOCK / TALK / NEXT (pull-ups, ~20 ms debounce) and call `cb` on
   **both** edges. TALK is push-to-talk, so `up` matters.
2. **LED ring**: render each pattern in the given color. Loop `idle`, `market_open`, `locking`, `locked`
   until the next command; play `join`, `win`, `loss`, `goal`, `error` once, then return to `idle`.
   Default colors per pattern are in `DEFAULT_LED_COLORS` (shared). On a Pi 5 the classic PWM WS281x
   driver does not work; use an SPI/PIO-based driver.
3. **NFC** (only with a PN532): write an NDEF URI record and resolve `true`. With a passive sticker tag
   leave `nfc: false`; the tag holds `https://<PUBLIC_ENGINE_URL>/j` and the engine redirects.
4. Flip the `capabilities` flags to `true` as each part works.

The server, validation and broadcasting (`src/server.ts`) need no changes. `pnpm --filter @huddle/box-bridge test`
checks the contract against the mock hardware.

### Pi service

Run with systemd next to the engine (PRD section 10 boot sequence), e.g.
`ExecStart=/usr/bin/env pnpm --filter @huddle/box-bridge start` with `WorkingDirectory` at the repo root.
GPIO access may need the service user in the `gpio` / `spi` groups.
