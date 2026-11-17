# DIPLINE — btc-race-24h-20261117-0603 entry status

**Competition:** btc-race-24h-20261117-0603 — "Race a BTC trading bot live for
24 hours", $250 (1st $60), entries close **2026-11-17T12:03:00Z (19:03 WIB)**.
**Status: built and grade-checked. NOT submitted — no GitHub repo created, no
keypair touched.** The builder session is `5d21418b-2459-49df-979f-828486dc2e2a`.

## The bot

**DIPLINE** — a mean-reversion bot in `~/workspace/makefun/btc-race/`
(`main.ts`, Node 22, stdlib only + the kit's SDK shim byte-identical under
`vendor/`). It trades cbBTC vs USDC on 1-minute bars over
agent-fun/bars-replay/v1, starts with 1,000 USDC paper, long only.

## Strategy

The dev window is choppy with a mild uptrend (ends +0.49%, range 2.5%).
A full-size round trip costs ~37 bps (4 bps fee + 2 bps slippage + ~13 bps
price impact each way at the pool's ~$790k depth), so frequent trading
loses: EMA-cross -$106.21 (68 trades), RSI/Bollinger -$24.25 (11),
ADX-momentum -$32.66 (26). Only one-trade bots made money
(buy-and-hold +$1.07, momentum +$2.45).

The one real signal in the window is hourly mean reversion:
non-overlapping 60-minute returns have lag-1 autocorrelation **-0.36**, and
after a 60-minute drop of more than 100 bps the next 60 minutes average
+40 bps (next 120 minutes +72 bps) against a 37 bps round trip.

- **Entry (flat):** close more than **110 bps below** the close 60 bars ago
  → buy with all cash (one order, full equity).
- **Exit (long), first of:** 60-minute return above **+100 bps** (bounce
  arrived); close **100 bps below** the peak since entry (trailing stop);
  position worth **100 bps under** its cost (hard stop); **240 bars** held
  (max hold). Sell the whole position.
- **Cooldown 120 bars** after an exit; **no new entries in the last 120
  bars** of the window (a late buy pays full entry cost for too little time
  to bounce).
- Orders cap slippage at 100 bps; a refused order is re-decided on the next
  bar while its signal still holds.

## Local grade (kit `grade-local`, `--driver process`)

| Run | Net PnL | Trades | Max DD | Sharpe | Fees | Rejected | Action log sha256 |
|---|---|---|---|---|---|---|---|
| 1 | **+$20.28** | 4 | 0.72% | 0.039 | $1.62 | 0 | `fae6e4fd…` |
| 2 | **+$20.28** | 4 | 0.72% | — | — | 0 | `fae6e4fd…` (identical) |
| 3 (after comment edit) | **+$20.28** | 4 | 0.72% | — | — | 0 | `fae6e4fd…` (identical) |

- **Dev gate: PASSES** — net PnL +$20.28 > 0, so the entry races if submitted.
- Guardrails: 4 trades (≥1 required), max drawdown 0.72% (≤25% required).
- The two trades: buy bar 374 (~$64,072) → sell bar 510 (~$64,830), +$9.71;
  buy bar 1097 (~$64,647) → sell bar 1286 (~$64,997), +$3.39.

## Determinism

Two independent `grade-local` runs produce byte-identical action logs
(`fae6e4fdae1d0d66e567c62d2f5d2573cdf0d78a2f0005b6f7ffaf9374399abd`),
and a third run after a comment-only edit gives the same log. No wall
clock, no environment, no randomness — float64 arithmetic on closes only.

## Robustness (offline simulator, exact harness fill model — reproduces
buy-and-hold's grade-local PnL to the cent)

- Time-reversed dev window: **+$10.14** (same config).
- Neighbours are flat, not spiky: entry -100 bp → +$18.44, -120 bp → +$6.03;
  exit +80 bp → +$14.92, +120 bp → +$15.58.
- Median $0.00 over 20 block-bootstrapped windows (the bot often does not
  trade at all on reshuffled paths); every trend-following variant tried
  lost $14–$48 on dev.

## Honest caveats

- The edge is one 24-hour window's hourly mean reversion (13–38 trigger
  events depending on threshold). The race window is unseen; if it trends
  hard in one direction the bot may sit out most of it or take a stopped
  loss (bounded ~-1.2% per round trip by the hard stop + costs).
- No grade-local judge score beyond the dev PnL exists; the race ranking is
  decided on the unseen 24h window alone.

## Remaining steps to submit (NOT done — for the parent agent)

1. **Fetch the intake requirements FIRST and satisfy every check before
   the first submit** (lesson from btc-cent-forecast-01 — each rejection
   consumes the daily quota; this competition allows max 10/day, 10 total):
   `GET /api/competitions/btc-race-24h-20261117-0603/requirements` —
   readme_template with the 3 live badges, repo_about
   description/homepage/topics, `.makefun/owner.json`, public repo created
   after the competition opened (2026-11-17T06:03:00Z).
2. Create a **new public GitHub repo** (e.g. `fmuammar99/btc-race-entry`)
   from `~/workspace/makefun/btc-race/` (main.ts, LICENSE, README.md,
   vendor/makefun-bars.ts).
3. Bundle the transcripts: `makefun bundle --session <this builder session
   file> --session <main session file> --no-discover --no-family`
   (the main session began before this competition opened, so bundling it
   would fail `thinking_in_window` — bundle the builder session ONLY, as
   was done for threejs-fps-02). Attach usage rows with `--muse-usage`.
   Note: `main.ts` was written in one write and then edited once more in
   this session (tuning-note comment), so `thinking_revised` has 2 messages.
4. `makefun check` on the bundle + repo (expect 0 failures; the bot's
   source was written in-session by this builder).
5. Submit with `--keypair` (check the requirements whether this bounty is
   escrowed; if so the keypair is REQUIRED). Claim code comes back via
   `makefun status --submission <id>` — keep it private, never store it in
   notes.
6. **Deadline 19:03 WIB today** — submit with time to spare; a rejected
   first submit burns quota and there is no second UTC day before the close.
