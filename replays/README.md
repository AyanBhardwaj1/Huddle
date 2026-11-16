# Replay timelines

Every `*.json` file in this folder is one game the Replay adapter (`@huddle/sports`) can play. The folder is found through the `REPLAY_DIR` environment variable, or relative to the package when it is not set. A file that fails validation is skipped with a console warning; it never stops the engine.

Both timelines here are **hand-authored** and written in **demo time**: the whole game fits in a few minutes at 1x so it is fun to play live. They are not real fixtures and are not affiliated with any league or federation.

| File | Game id | Length at 1x | What is in it |
| --- | --- | --- | --- |
| `portugal-spain.json` | `replay-por-esp` | 6 min 50 s | Kickoff, Ronaldo penalty awarded at 0:32 and scored at 0:59, seven goals (4-3), four yellow cards, four corners with outcomes, halftime, the 60th and 80th minute marks, full time |
| `titans-cowboys.json` | `replay-ten-dal` | 4 min 56 s | Four featured drives, three 3rd downs and one 4th down with a snap then a result 22 s later, two red-zone trips ending in touchdowns, a field goal, a missed extra point, four quarters, final (14-9) |

## File format

```jsonc
{
  "id": "replay-por-esp",          // game id, unique across the folder
  "sport": "soccer",               // "soccer" | "nfl"
  "title": "Portugal vs Spain",
  "home": { "name": "Portugal", "short": "POR", "color": "#C8102E" },
  "away": { "name": "Spain", "short": "ESP", "color": "#F1BF00" },
  "durationMs": 410000,            // optional; default = last event + 3 s
  "startsAt": "2026-11-22T18:00:00.000Z", // optional; helps the Gemini matcher pick the right game
  "videoUrl": "/media/por-esp.mp4",       // optional; video synced to the timeline
  "description": "free text",
  "events": [ /* entries, see below */ ]
}
```

Each entry becomes one normalized `GameEvent`. Entries are sorted by `atMs` and numbered `seq = 1, 2, 3, ...`.

| Field | Required | Meaning |
| --- | --- | --- |
| `atMs` | yes | Demo time in ms from the start of the replay at 1x |
| `type` | yes | A `GameEventType`: `kickoff`, `goal`, `penalty_awarded`, `penalty_result`, `corner`, `card`, `sub`, `snap`, `play_result`, `drive_start`, `drive_end`, `period_start`, `period_end`, `final`, `score_update` |
| `period` | no | Period number. Carried forward from the previous entry (starts at 1) |
| `minute` | soccer | Elapsed match minute. Sets `data.minute` and the clock display (`"23'"`). Carried forward |
| `clock` | NFL | Game clock `"MM:SS"`. Sets the clock display and `data.secondsRemaining` (4 x 15:00 quarters) |
| `team` | no | Team short code, must match `home.short` or `away.short` |
| `player` | no | Player name |
| `data` | no | Type-specific payload, see the conventions below |
| `score` | no | `[home, away]` after this event. If omitted the score is carried forward; a soccer `goal` adds one to its team automatically. NFL scores must be written out |
| `text` | no | Commentary line for the box ticker |

### `data` conventions

- `penalty_result`: `{ "scored": true | false }`
- `card`: `{ "color": "yellow" | "red" }`
- `corner`: two events per corner. The **award** has no `shotOnTarget`; the **outcome** (same team, about 20 to 25 s later) has `{ "shotOnTarget": true | false }`. The corner market opens on the award and resolves on the outcome.
- `drive_start`: `{ "yardline": 25 }` (yards from the offense's own goal line, 1 to 99)
- `snap`: `{ "down", "distance", "yardline" }`, plus `"goForIt": true` when the offense is lining up to go for it on 4th down (or `"punt": true` / `"kick": true` when it is not). A `snap` is the pre-snap situation and is what opens a conversion market, so only write one for plays you want a market on.
- `play_result`: `{ "down", "distance", "yardline", "playType": "run" | "pass" | "kick" | "punt", "gained", "firstDown", "touchdown"?, "turnover"?, "good"? (field goals), "noPlay"? (penalty, down replayed) }`
- `drive_end`: `{ "result": "td" | "fg" | "none" }`
- `period_start` / `period_end`: `data.period` is filled in from `period` automatically.

### Authoring rules (the tests in `packages/sports` and `packages/models` enforce these for the two files here)

1. Leave **at least 20 s** of demo time between a moment trigger and its result (penalty awarded to result, corner award to outcome, 3rd/4th-down `snap` to its `play_result`, red-zone entry to the touchdown), so there is time to bet and the market locks before the answer arrives.
2. Leave **at least 20 s** between two moment triggers. The party engine opens at most one new moment market every 20 s, so a trigger that comes sooner may be dropped.
3. NFL downs, distances and yard lines must chain: each `play_result` starts where the previous one ended.
4. Start with `kickoff` and end with `final`.

## Playback semantics

- A feed is created **paused** at position 0. `control.start()` runs the replay clock at `speed` x wall time.
- Events are delivered in `seq` order, each exactly once per pass, with `ts` set to the wall clock at delivery.
- `control.setSpeed(x)` accepts 0.25 to 20 (clamped) and takes effect immediately, playing or paused.
- `control.pause()` freezes the position; `start()` resumes from it.
- `control.seek(ms)` **forward**: every event not yet delivered up to the new position is delivered at once, in order, with `data.catchUp = true`. Nothing is delivered twice.
- `control.seek(ms)` **backward**: the feed rewinds to the top and immediately re-delivers events 1..k (those at or before the new position) with `data.catchUp = true`. Consumers see `seq` restart at 1; `reduce()` detects that (`seq <= lastSeq`) and rebuilds its state from scratch. `seek(0)` delivers nothing.
- The question engine proposes **no markets for catch-up events** (the moment has passed). To demo the opening penalty, play from the start rather than seeking to it.
- After the last event the feed pauses itself. `feed.stop()` ends it for good.
