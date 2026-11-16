#!/usr/bin/env python3.11
"""
Build the NFL pricing tables and (P1) logistic-regression coefficients for Huddle.

Source: nflverse play-by-play (https://github.com/nflverse/nflverse-data/releases, tag `pbp`).
Output: packages/models/models/nfl.json  (evaluated by the TypeScript runtime; no Python in the live path)

Usage:
    cd ml && python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python train_nfl.py --seasons 2021 2022 2023 2024

Raw data is cached in ml/data/ (gitignored). Never commit it.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import requests

HERE = Path(__file__).resolve().parent
DATA = HERE / "data" / "nflverse"
OUT = HERE.parent / "packages" / "models" / "models" / "nfl.json"
URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{year}.parquet"

COLS = [
    "game_id", "season", "season_type", "home_team", "away_team", "posteam", "qtr", "down", "ydstogo",
    "yardline_100", "play_type", "first_down", "touchdown", "td_team", "score_differential",
    "game_seconds_remaining", "fixed_drive", "fixed_drive_result", "total_home_score", "total_away_score",
    "pass", "rush", "qb_kneel", "qb_spike",
]

DIST_BUCKETS = [("1", 1, 1), ("2", 2, 2), ("3", 3, 3), ("4-6", 4, 6), ("7-10", 7, 10), ("11-15", 11, 15), ("16+", 16, 99)]
# Yards from the offense's own goal line (GameEvent convention: 1..99).
FIELD_BUCKETS = [("own_1_10", 1, 10), ("own_11_20", 11, 20), ("own_21_30", 21, 30), ("own_31_40", 31, 40),
                 ("own_41_50", 41, 50), ("opp_49_40", 51, 60), ("opp_39_30", 61, 70), ("opp_29_20", 71, 80),
                 ("opp_19_10", 81, 90), ("opp_9_1", 91, 99)]
REDZONE_BUCKETS = [("opp_20_11", 80, 89), ("opp_10_6", 90, 94), ("opp_5_1", 95, 99)]
GO_ZONES = [("own_1_40", 1, 40), ("own_41_opp_41", 41, 59), ("opp_40_21", 60, 79), ("opp_20_1", 80, 99)]


def bucket(value: float, buckets) -> str | None:
    for name, lo, hi in buckets:
        if lo <= value <= hi:
            return name
    return None


def download(year: int, timeout: int) -> Path:
    DATA.mkdir(parents=True, exist_ok=True)
    path = DATA / f"play_by_play_{year}.parquet"
    if path.exists() and path.stat().st_size > 1_000_000:
        return path
    print(f"downloading {year} ...", flush=True)
    with requests.get(URL.format(year=year), stream=True, timeout=timeout) as r:
        r.raise_for_status()
        tmp = path.with_suffix(".part")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
        tmp.rename(path)
    return path


def rate_table(df: pd.DataFrame, key_cols: list[str], target: str, min_n: int = 30) -> dict:
    out: dict = {}
    g = df.groupby(key_cols)[target].agg(["mean", "count"])
    for idx, row in g.iterrows():
        keys = idx if isinstance(idx, tuple) else (idx,)
        node = out
        for k in keys[:-1]:
            node = node.setdefault(str(k), {})
        node[str(keys[-1])] = {"p": round(float(row["mean"]), 4), "n": int(row["count"])}
    return out


def fit_logit(X: np.ndarray, y: np.ndarray, features: list[str]) -> dict:
    from sklearn.linear_model import LogisticRegression

    m = LogisticRegression(C=10.0, max_iter=2000)
    m.fit(X, y)
    return {
        "features": features,
        "intercept": round(float(m.intercept_[0]), 5),
        "coef": [round(float(c), 5) for c in m.coef_[0]],
        "n": int(len(y)),
        "base_rate": round(float(y.mean()), 4),
    }


def fit_multinomial(X: np.ndarray, y: np.ndarray, features: list[str], classes: list[str]) -> dict:
    from sklearn.linear_model import LogisticRegression

    m = LogisticRegression(C=10.0, max_iter=3000)
    m.fit(X, y)
    order = [list(m.classes_).index(c) for c in classes]
    return {
        "features": features,
        "classes": classes,
        "intercept": [round(float(m.intercept_[i]), 5) for i in order],
        "coef": [[round(float(c), 5) for c in m.coef_[i]] for i in order],
        "n": int(len(y)),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, nargs="+", default=[2021, 2022, 2023, 2024])
    ap.add_argument("--timeout", type=int, default=120)
    ap.add_argument("--no-logit", action="store_true", help="tables only (skip scikit-learn)")
    args = ap.parse_args()

    frames = []
    for y in args.seasons:
        try:
            p = download(y, args.timeout)
            frames.append(pd.read_parquet(p, columns=COLS))
        except Exception as e:  # noqa: BLE001
            print(f"season {y} failed: {e}", file=sys.stderr)
    if not frames:
        print("no data downloaded; keeping the existing nfl.json", file=sys.stderr)
        return 1
    pbp = pd.concat(frames, ignore_index=True)
    pbp = pbp[pbp["season_type"] == "REG"]
    seasons = sorted(int(s) for s in pbp["season"].unique())
    print(f"{len(pbp):,} regular-season rows, seasons {seasons}")

    scrim = pbp[pbp["down"].notna() & pbp["yardline_100"].notna() & pbp["ydstogo"].notna()].copy()
    scrim["down"] = scrim["down"].astype(int)
    scrim["dist"] = scrim["ydstogo"].clip(lower=1).map(lambda v: bucket(v, DIST_BUCKETS))
    scrim["yardline"] = (100 - scrim["yardline_100"]).clip(1, 99)  # yards from own goal line
    off_td = (scrim["touchdown"] == 1) & (scrim["td_team"] == scrim["posteam"])
    scrim["converted"] = ((scrim["first_down"] == 1) | off_td).astype(int)

    # ---- conversion on run/pass plays (i.e. when the offense goes for it) ----
    go = scrim[scrim["play_type"].isin(["run", "pass"]) & (scrim["qb_kneel"] != 1) & (scrim["qb_spike"] != 1)].copy()
    conv = go[go["down"].isin([3, 4])]
    conversion = rate_table(conv, ["down", "dist"], "converted")

    # ---- 4th down: how often do they go for it? ----
    fourth = scrim[(scrim["down"] == 4) & scrim["play_type"].isin(["run", "pass", "punt", "field_goal"])].copy()
    fourth["went"] = fourth["play_type"].isin(["run", "pass"]).astype(int)
    fourth["zone"] = fourth["yardline"].map(lambda v: bucket(v, GO_ZONES))
    fourth_go = rate_table(fourth, ["zone", "dist"], "went", min_n=1)

    # ---- pass rate by down and distance ----
    pr = go[go["down"].isin([1, 2, 3, 4])].copy()
    pr["is_pass"] = (pr["pass"] == 1).astype(int)
    pass_rate = rate_table(pr, ["down", "dist"], "is_pass")

    # ---- drive results ----
    def drive_class(r: str) -> str:
        if r == "Touchdown":
            return "td"
        if r == "Field goal":
            return "fg"
        return "none"

    dr = scrim[scrim["fixed_drive"].notna() & scrim["fixed_drive_result"].notna()]
    first = dr.sort_values(["game_id", "fixed_drive"]).groupby(["game_id", "fixed_drive"], as_index=False).first()
    first["result"] = first["fixed_drive_result"].map(drive_class)
    first["field"] = first["yardline"].map(lambda v: bucket(v, FIELD_BUCKETS))
    drive_result: dict = {}
    for name, grp in first.groupby("field"):
        n = len(grp)
        drive_result[str(name)] = {
            "td": round(float((grp["result"] == "td").mean()), 4),
            "fg": round(float((grp["result"] == "fg").mean()), 4),
            "none": round(float((grp["result"] == "none").mean()), 4),
            "n": int(n),
        }
    overall = {c: round(float((first["result"] == c).mean()), 4) for c in ("td", "fg", "none")}
    overall["n"] = int(len(first))

    # ---- red zone: first snap of a drive inside the opponent 20 -> how does the drive end? ----
    rz = dr[dr["yardline"] >= 80].sort_values(["game_id", "fixed_drive"]).groupby(["game_id", "fixed_drive"], as_index=False).first()
    rz["result"] = rz["fixed_drive_result"].map(drive_class)
    rz["zone"] = rz["yardline"].map(lambda v: bucket(v, REDZONE_BUCKETS))
    red_zone: dict = {}
    for name, grp in rz.groupby("zone"):
        red_zone[str(name)] = {
            "td": round(float((grp["result"] == "td").mean()), 4),
            "fg": round(float((grp["result"] == "fg").mean()), 4),
            "none": round(float((grp["result"] == "none").mean()), 4),
            "n": int(len(grp)),
        }
    red_zone["all"] = {
        "td": round(float((rz["result"] == "td").mean()), 4),
        "fg": round(float((rz["result"] == "fg").mean()), 4),
        "none": round(float((rz["result"] == "none").mean()), 4),
        "n": int(len(rz)),
    }

    # ---- points model: game totals and period winners ----
    q = pbp[pbp["qtr"].between(1, 4)].groupby(["game_id", "qtr"])[["total_home_score", "total_away_score"]].max().reset_index()
    q = q.sort_values(["game_id", "qtr"])
    q["home_pts"] = q.groupby("game_id")["total_home_score"].diff().fillna(q["total_home_score"])
    q["away_pts"] = q.groupby("game_id")["total_away_score"].diff().fillna(q["total_away_score"])
    finals = q.groupby("game_id")[["total_home_score", "total_away_score"]].max()
    totals = finals["total_home_score"] + finals["total_away_score"]

    def winner_rates(home: pd.Series, away: pd.Series) -> dict:
        return {
            "home": round(float((home > away).mean()), 4),
            "tie": round(float((home == away).mean()), 4),
            "away": round(float((home < away).mean()), 4),
            "n": int(len(home)),
            "mean_points": round(float((home + away).mean()), 3),
        }

    period_winner = {}
    for qtr in (1, 2, 3, 4):
        sub = q[q["qtr"] == qtr]
        period_winner[f"Q{qtr}"] = winner_rates(sub["home_pts"], sub["away_pts"])
    for half, qs in (("H1", (1, 2)), ("H2", (3, 4))):
        sub = q[q["qtr"].isin(qs)].groupby("game_id")[["home_pts", "away_pts"]].sum()
        period_winner[half] = winner_rates(sub["home_pts"], sub["away_pts"])

    points = {
        "mean_total": round(float(totals.mean()), 3),
        "sd_total": round(float(totals.std()), 3),
        "mean_home": round(float(finals["total_home_score"].mean()), 3),
        "mean_away": round(float(finals["total_away_score"].mean()), 3),
        "sd_margin": round(float((finals["total_home_score"] - finals["total_away_score"]).std()), 3),
        "home_win": round(float((finals["total_home_score"] > finals["total_away_score"]).mean()), 4),
        "n_games": int(len(finals)),
    }

    out = {
        "trained": True,
        "source": "nflverse play-by-play (github.com/nflverse/nflverse-data, release tag pbp), regular season",
        "seasons": seasons,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "script": "ml/train_nfl.py",
        "notes": {
            "yardline": "yards from the offense's own goal line (1..99), same as GameEvent.data.yardline",
            "conversion": "P(first down or TD) on run/pass plays, by down and yards-to-go bucket",
            "fourth_go": "P(offense runs a play rather than punting/kicking) on 4th down, by field zone and distance",
            "drive_result": "how drives end, by the yard line of the drive's first scrimmage play",
            "red_zone": "how drives end, given the first snap inside the opponent 20",
        },
        "dist_buckets": [{"name": n, "min": lo, "max": hi} for n, lo, hi in DIST_BUCKETS],
        "field_buckets": [{"name": n, "min": lo, "max": hi} for n, lo, hi in FIELD_BUCKETS],
        "red_zone_buckets": [{"name": n, "min": lo, "max": hi} for n, lo, hi in REDZONE_BUCKETS],
        "go_zones": [{"name": n, "min": lo, "max": hi} for n, lo, hi in GO_ZONES],
        "conversion": conversion,
        "fourth_go": fourth_go,
        "pass_rate": pass_rate,
        "drive_result": drive_result,
        "drive_result_overall": overall,
        "red_zone": red_zone,
        "period_winner": period_winner,
        "points": points,
    }

    if not args.no_logit:
        try:
            def feats(df: pd.DataFrame) -> np.ndarray:
                return np.column_stack([
                    (df["down"] == 4).astype(float),
                    np.log(df["ydstogo"].clip(lower=1).astype(float)),
                    df["yardline"].astype(float) / 100.0,
                    df["score_differential"].fillna(0).clip(-30, 30).astype(float) / 10.0,
                    df["game_seconds_remaining"].fillna(1800).astype(float) / 3600.0,
                ])

            names = ["down4", "ln_ydstogo", "yardline_frac", "score_diff_10", "secs_remaining_frac"]
            c = conv.dropna(subset=["converted"])
            out["logit_conversion"] = fit_logit(feats(c), c["converted"].to_numpy(), names)

            def pfeats(df: pd.DataFrame) -> np.ndarray:
                return np.column_stack([
                    (df["down"] == 2).astype(float),
                    (df["down"] == 3).astype(float),
                    (df["down"] == 4).astype(float),
                    np.log(df["ydstogo"].clip(lower=1).astype(float)),
                    df["yardline"].astype(float) / 100.0,
                    df["score_differential"].fillna(0).clip(-30, 30).astype(float) / 10.0,
                    df["game_seconds_remaining"].fillna(1800).astype(float) / 3600.0,
                ])

            pnames = ["down2", "down3", "down4", "ln_ydstogo", "yardline_frac", "score_diff_10", "secs_remaining_frac"]
            out["logit_pass"] = fit_logit(pfeats(pr), pr["is_pass"].to_numpy(), pnames)

            d = first.dropna(subset=["yardline"])
            X = np.column_stack([
                d["yardline"].astype(float) / 100.0,
                d["score_differential"].fillna(0).clip(-30, 30).astype(float) / 10.0,
                d["game_seconds_remaining"].fillna(1800).astype(float) / 3600.0,
            ])
            out["multinomial_drive"] = fit_multinomial(
                X, d["result"].to_numpy(), ["yardline_frac", "score_diff_10", "secs_remaining_frac"], ["td", "fg", "none"]
            )
        except Exception as e:  # noqa: BLE001
            print(f"logistic fits skipped: {e}", file=sys.stderr)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote {OUT}")
    c3 = conversion.get("3", {})
    print("3rd down:", {k: v["p"] for k, v in c3.items()})
    print("drive overall:", overall, "| red zone:", red_zone["all"], "| points:", points)
    assert c3["1"]["p"] > c3["7-10"]["p"], "sanity: 3rd and 1 must convert more often than 3rd and long"
    assert not math.isnan(points["mean_total"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
