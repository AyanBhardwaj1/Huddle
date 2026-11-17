# End-to-end tests (Playwright)

```sh
pnpm e2e:install   # once: Playwright's headless Chromium only (about 180 MB)
pnpm e2e           # builds the UIs if dist/ is missing or stale, then runs e2e/*.spec.ts
```

`e2e/support/engine-server.ts` runs the engine as a child process on a random port. It uses the real adapters: the Replay feed (`replay-por-esp`), the real question engine and pricing models, the announcer in Web Speech mode, offline Gemini sample odds, and points settlement. The replay runs at 10x and every engine timer is divided by 10 (`EngineTiming.timeScale`). The engine serves the built `apps/box/dist` at `/box/` and `apps/player/dist` at `/`, so the tests drive the real pages.

| Test | What it proves |
| --- | --- |
| `pool mode in the browser`, `amm mode in the browser` | The box UI creates a party. Two phone-sized pages join by link, type a name and buy in. The box starts the game. The phones bet on opposite sides of the same market. The game runs to the end. The test checks that the market resolved, the winner was paid more than the loser, payouts (players + house) sum exactly to deposits, both phones show `finalized` and their own payout, and the box shows `finalized`. |
| `pool, market and bet modes with bot players` | Three parties on the same engine, one per mode, each with three `HuddleClient` bots that trade randomly but validly. The test checks that every party finalizes, payouts sum to deposits, markets resolve, the mode-specific actions happened, and balances changed. |

## Test hooks: keep these when changing the UI

The tests select elements **only** by the `data-testid` attributes below, never by CSS classes, layout or copy. A redesign can change anything else, but every hook here must stay on an element with the same meaning. Hooks marked "clickable" must remain clickable buttons or inputs.

### Box UI (`apps/box`)

| `data-testid` | On | Extra attributes |
| --- | --- | --- |
| `start-party` | Home: the button that opens party creation (clickable; enabled when the engine is online) | |
| `game-option` | Create party: one button per game (clickable) | `data-game-id` = the game id, e.g. `replay-por-esp` |
| `mode-pool`, `mode-amm`, `mode-bet` | Create party: the play-mode choices (clickable) | |
| `settlement-points`, `settlement-trusted`, `settlement-vault` | Create party: the money choices (clickable) | |
| `create-party` | Create party: the submit button (clickable) | |
| `party-status` | Any party screen (lobby, live, end), may be hidden | `data-status` = the party status: `lobby`, `live`, `ended`, `closing` or `finalized` |
| `party-code` | Lobby: the element whose text is exactly the 4-letter party code | |
| `lobby-player` | Lobby: one element per joined player | `data-player-name` = the player's name |
| `sound-gate` | The "enable sound" overlay, when shown (clickable; clicking it dismisses it) | |
| `start-game` | Lobby: the button that starts the game (clickable) | |

The box keeps its session in `localStorage['huddle.box.session']` as `{ partyCode, hostToken }`. The test reads the host token from there. `/box/#party=CODE&host=TOKEN` adopts a party (`takeSessionFromUrl`, used by `pnpm demo`).

### Player app (`apps/player`)

| `data-testid` | On | Extra attributes |
| --- | --- | --- |
| `join-name` | Join page (`/j/CODE`): the name input | |
| `join-submit` | Join page: the join button (clickable) | |
| `buy-in` | Buy-in screen: the buy-in button (clickable) | |
| `buy-in-done` | Buy-in screen: the "you're in" confirmation shown after the deposit lands. It must show, and the app must then move on to the party screen without a tap. | |
| `party-status` | The party screen (live and end of game) | `data-status` = the party status |
| `market-card` | One element per market | `data-market-id` = market id, `data-market-state` = market state |
| `outcome-<id>` | Inside a pool or Market-mode `market-card`: the button that picks that outcome (clickable; enabled while the market is open). `<id>` is the outcome id (`yes`, `no`, `home`, `draw`, `away`, …) | |
| `stake-chip` | Inside that `market-card`, after an outcome is picked: one-tap stake buttons (clickable; a click places the bet). They disappear once the bet is accepted. | `data-stake` = stake in base units |
| `my-payout` | End of game, once finalized: this player's payout | `data-amount` = payout in base units |
| `final-leaderboard` | End of game: the final leaderboard | |

## Notes

- Several pages share one headless browser. The config turns off background-tab throttling, so each phone page keeps running as it would in the foreground on a real device.
- Nothing waits on a fixed time. Every wait is on a hook above, on `GET /parties/:code`, or on a box-role `HuddleClient` observer.
