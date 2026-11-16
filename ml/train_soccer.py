#!/usr/bin/env python3.11
"""
Build the soccer pricing table for Huddle from StatsBomb open data.

Source: https://github.com/statsbomb/open-data (free event data; see their LICENSE for attribution terms).
Output: packages/models/models/soccer.json (evaluated by the TypeScript runtime; no Python in the live path)

What is computed:
  - penalty base rate: in-play penalties (shootouts excluded) scored / taken, plus per-taker counts
  - corner -> shot on target within 20 s by the attacking team
  - cards per match by half (for "another card before halftime?")
  - mean goals per match (information only; the Poisson defaults stay at the PRD values)

Usage:
    cd ml && .venv/bin/python train_soccer.py                 # default competition set
    cd ml && .venv/bin/python train_soccer.py --max-matches 80 # quick run

Per-match extracts are cached in ml/data/statsbomb/ (gitignored). Raw event files are never written to disk.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
CACHE = HERE / "data" / "statsbomb"
OUT = HERE.parent / "packages" / "models" / "models" / "soccer.json"
BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"

# (competition_id, season_id, label). Men's international tournaments first, then a full league season.
DEFAULT_COMPETITIONS = [
    (43, 106, "FIFA World Cup 2022"),
    (43, 3, "FIFA World Cup 2018"),
    (55, 282, "UEFA Euro 2024"),
    (55, 43, "UEFA Euro 2020"),
    (223, 282, "Copa America 2024"),
    (11, 27, "La Liga 2015/16"),
    (2, 27, "Premier League 2015/16"),
    (12, 27, "Serie A 2015/16"),
    (9, 27, "Bundesliga 2015/16"),
    (7, 27, "Ligue 1 2015/16"),
]

ON_TARGET = {"Goal", "Saved", "Saved To Post"}


def clock_secs(ev: dict) -> float:
    return ev.get("minute", 0) * 60 + ev.get("second", 0)


def extract(match: dict, events: list[dict]) -> dict:
    """Reduce one match's events to the handful of counts we need."""
    pens = []
    corners = 0
    corners_sot = 0
    cards = {"1": 0, "2": 0}
    goals = {"home": 0, "away": 0}
    home = match["home_team"]["home_team_name"]
    by_period: dict[int, list[dict]] = {}
    for ev in events:
        by_period.setdefault(ev.get("period", 0), []).append(ev)
    for period, evs in by_period.items():
        if period > 4:  # 5 = penalty shootout
            continue
        for i, ev in enumerate(evs):
            t = ev.get("type", {}).get("name")
            if t == "Shot":
                shot = ev.get("shot", {})
                outcome = shot.get("outcome", {}).get("name")
                if shot.get("type", {}).get("name") == "Penalty":
                    pens.append({"player": ev.get("player", {}).get("name"), "scored": outcome == "Goal"})
                if outcome == "Goal":
                    goals["home" if ev.get("team", {}).get("name") == home else "away"] += 1
            elif t == "Own Goal For":
                goals["home" if ev.get("team", {}).get("name") == home else "away"] += 1
            elif t == "Pass" and ev.get("pass", {}).get("type", {}).get("name") == "Corner":
                corners += 1
                team = ev.get("team", {}).get("name")
                t0 = clock_secs(ev)
                for nxt in evs[i + 1:]:
                    if clock_secs(nxt) - t0 > 20:
                        break
                    if (nxt.get("type", {}).get("name") == "Shot" and nxt.get("team", {}).get("name") == team
                            and nxt.get("shot", {}).get("outcome", {}).get("name") in ON_TARGET):
                        corners_sot += 1
                        break
            card = (ev.get("foul_committed", {}).get("card") or ev.get("bad_behaviour", {}).get("card") or {}).get("name")
            if card and period in (1, 2):
                cards[str(period)] += 1
    return {"match_id": match["match_id"], "penalties": pens, "corners": corners, "corners_sot": corners_sot,
            "cards": cards, "goals": goals}


def fetch_match(session: requests.Session, match: dict, timeout: int) -> dict | None:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{match['match_id']}.json"
    if path.exists():
        return json.loads(path.read_text())
    try:
        r = session.get(f"{BASE}/events/{match['match_id']}.json", timeout=timeout)
        r.raise_for_status()
        out = extract(match, r.json())
        path.write_text(json.dumps(out))
        return out
    except Exception as e:  # noqa: BLE001
        print(f"match {match['match_id']} failed: {e}", file=sys.stderr)
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-matches", type=int, default=0, help="stop after this many matches (0 = all)")
    ap.add_argument("--budget-secs", type=int, default=600, help="wall-clock budget; partial results are still written")
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--timeout", type=int, default=45)
    args = ap.parse_args()

    session = requests.Session()
    matches: list[tuple[str, dict]] = []
    used: list[str] = []
    for comp, season, label in DEFAULT_COMPETITIONS:
        try:
            r = session.get(f"{BASE}/matches/{comp}/{season}.json", timeout=args.timeout)
            r.raise_for_status()
            ms = r.json()
            matches += [(label, m) for m in ms]
            used.append(f"{label} ({len(ms)} matches)")
            print(f"{label}: {len(ms)} matches", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"{label} match list failed: {e}", file=sys.stderr)
    if args.max_matches:
        matches = matches[: args.max_matches]
    if not matches:
        print("no match lists downloaded; keeping the existing soccer.json", file=sys.stderr)
        return 1

    start = time.time()
    rows: list[dict] = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = [pool.submit(fetch_match, session, m, args.timeout) for _, m in matches]
        for n, f in enumerate(as_completed(futs), 1):
            res = f.result()
            if res:
                rows.append(res)
            if n % 50 == 0:
                print(f"  {n}/{len(futs)} matches ({time.time() - start:.0f}s)", flush=True)
            if time.time() - start > args.budget_secs:
                print("time budget reached; cancelling the rest", file=sys.stderr)
                for other in futs:
                    other.cancel()
                break
    if len(rows) < 20:
        print("too few matches downloaded; keeping the existing soccer.json", file=sys.stderr)
        return 1

    pens = [p for r in rows for p in r["penalties"]]
    scored = sum(1 for p in pens if p["scored"])
    takers: dict[str, dict] = {}
    for p in pens:
        if not p["player"]:
            continue
        t = takers.setdefault(p["player"], {"attempts": 0, "scored": 0})
        t["attempts"] += 1
        t["scored"] += int(p["scored"])
    top = {k: v for k, v in sorted(takers.items(), key=lambda kv: -kv[1]["attempts"]) if v["attempts"] >= 3}
    corners = sum(r["corners"] for r in rows)
    corners_sot = sum(r["corners_sot"] for r in rows)
    n = len(rows)
    cards1 = sum(r["cards"]["1"] for r in rows) / n
    cards2 = sum(r["cards"]["2"] for r in rows) / n
    gh = sum(r["goals"]["home"] for r in rows) / n
    ga = sum(r["goals"]["away"] for r in rows) / n

    existing = json.loads(OUT.read_text()) if OUT.exists() else {}
    out = {
        **existing,
        "trained": True,
        "source": "StatsBomb open data (github.com/statsbomb/open-data): " + "; ".join(used),
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "script": "ml/train_soccer.py",
        "matches": n,
        "penalty": {
            "base_rate": round(scored / max(1, len(pens)), 4),
            "attempts": len(pens),
            "scored": scored,
            "shrinkage_k": 20,
            "note": "in-play penalties only (shootouts excluded)",
            "takers_in_sample": top,
            "career": existing.get("penalty", {}).get("career", {}),
        },
        "corner": {
            "shot_on_target_rate": round(corners_sot / max(1, corners), 4),
            "corners": corners,
            "window_secs": 20,
            "note": "attacking team has a shot on target (goal or saved) within 20 s of the corner",
        },
        "cards": {
            "per_match_first_half": round(cards1, 3),
            "per_match_second_half": round(cards2, 3),
            "note": "yellow + red cards, both teams",
        },
        "goals": {
            **existing.get("goals", {}),
            "sample_mean_home": round(gh, 3),
            "sample_mean_away": round(ga, 3),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {OUT}")
    print(f"penalties {scored}/{len(pens)} = {out['penalty']['base_rate']}, corner SOT {out['corner']['shot_on_target_rate']} "
          f"({corners} corners), cards/half {cards1:.2f}/{cards2:.2f}, goals {gh:.2f}/{ga:.2f} over {n} matches")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
