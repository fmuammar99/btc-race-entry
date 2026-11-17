// DIPLINE — a mean-reversion bot for btc-race-24h-20261117-0603.
//
// The dev window (24h of cbBTC 1-minute bars) is choppy with a mild uptrend:
// price ends +0.49% over the window, range 2.5%, and every baseline that
// trades often loses money to the ~37 bps full-size round trip (4 bps fee +
// 2 bps slippage + ~13 bps of price impact each way at the pool's depth).
// EMA-cross made -$106 on 68 trades; RSI/Bollinger -$24 on 11; ADX -$33 on
// 26. Only the bots that traded once (buy-and-hold +$1.07, momentum +$2.45)
// made money.
//
// The window does carry one real signal: hourly returns mean-revert.
// Non-overlapping 60-minute log returns have lag-1 autocorrelation -0.36,
// and after a 60-minute drop of more than 100 bps the next 60 minutes
// average +40 bps (the next 120 minutes +72 bps), against a 37 bps round
// trip. So this bot trades rarely and only on deep hourly dips:
//
//   - Entry (flat): the close is more than 110 bps below the close 60 bars
//     ago. Buy with all cash, one order, full equity.
//   - Exit (long): the first of (a) the close is more than 100 bps above
//     the close 60 bars ago (the bounce arrived), (b) the close fell more
//     than 100 bps from the peak since entry (trailing stop), (c) the
//     position is worth more than 100 bps under its cost (hard stop),
//     (d) 240 bars have passed since entry (max hold). Sell the whole
//     position.
//   - After an exit, wait 120 bars before the next entry (cooldown), so one
//     dip is not chased twice.
//   - No new entries in the last 120 bars of the window: a buy that late
//     pays the full entry cost for too little time to bounce.
//
// Everything is deterministic: float64 arithmetic on the closes alone, no
// clock, no environment, no randomness. The SDK shim owns the wire
// (agent-fun/bars-replay/v1); orders are decided on a bar's close and fill
// at the next bar's open. A buy the market refuses (a gap past the 1%
// slippage cap) is simply decided again on the next bar while its signal
// still holds; the same for a refused sell while an exit reason holds.

// Tuning evidence (offline simulator, exact harness fill model — it
// reproduces buy-and-hold's grade-local PnL to the cent, +$1.07):
//   - This config: dev +$20.28, 4 trades, max DD 0.72%; time-reversed dev
//     window +$10.14; median $0.00 over 20 block-bootstrapped windows
//     (the bot often does not trade at all on reshuffled paths).
//   - Neighbours are flat, not spiky: entry -100 bp gives +$18.44, -120 bp
//     +$6.03; exit +80 bp gives +$14.92, +120 bp +$15.58 — no cliff edge.
//   - By contrast every trend-following variant tried (EMA cross, Donchian
//     breakout, wide-exit trend rides) lost $14 to $48 on dev: the window
//     punishes chasing moves and rewards catching the hourly bounce.

import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

/** Bars of lookback for the dip / bounce return. */
const LOOKBACK_BARS = 60;
/** Entry: close more than this many bps under the close LOOKBACK_BARS ago. */
const ENTRY_BPS = -110;
/** Exit: close more than this many bps over the close LOOKBACK_BARS ago. */
const EXIT_BPS = 100;
/** Exit: close more than this many bps under the peak since entry. */
const TRAIL_BPS = 100;
/** Exit: position worth more than this many bps under its cost. */
const STOP_BPS = 100;
/** Bars to wait after an exit before the next entry. */
const COOLDOWN_BARS = 120;
/** Bars after entry when the position is sold whatever the price. */
const MAX_HOLD_BARS = 240;
/** Scored window length in bars (1,440 one-minute bars = 24h). */
const WINDOW_BARS = 1440;
/** No new entries in the last this many bars of the window. */
const NO_ENTRY_TAIL_BARS = 120;
/** Slippage cap on every order, 1% past the close it was decided on. */
const MAX_SLIPPAGE_BPS = 100;

/** The symbol's close per batch seq (null before its first bar / on a gap). */
const closes: (number | null)[] = [];
/** Highest close seen since the current entry (raw price units). */
let peak = 0;
/** Seq of the current entry's decision bar (-1 while flat). */
let entrySeq = -1;
/** Seq of the last exit's decision bar (-1e9 while never exited). */
let lastExitSeq = -1e9;

await runBars({
  onBatch(state, batch) {
    const symbol = state.hello.symbols[0].symbol;
    // Record this bar's close first: the batch's bars are already folded in.
    const bar = state.latest.get(symbol);
    closes.push(bar === undefined ? null : Number(bar.c));
    if (state.warmingUp) return [];

    const held = state.positions.get(symbol);
    const i = batch.seq;
    const close = closes[i];
    if (close === null) return [];

    if (held !== undefined) {
      if (close > peak) peak = close;
      const value = state.value(symbol, held.qty);
      const cost = held.cost;
      // (b) trailing stop: close TRAIL_BPS under the peak since entry.
      const trailed = close < peak * (1 - TRAIL_BPS / 10000);
      // (c) hard stop: value STOP_BPS under cost, compared exactly.
      const stopped = value * BPS < cost * (BPS - BigInt(STOP_BPS));
      // (d) max hold.
      const stale = i - entrySeq >= MAX_HOLD_BARS;
      // (a) the bounce arrived: 60-minute return past EXIT_BPS.
      let bounced = false;
      if (i >= LOOKBACK_BARS) {
        const then = closes[i - LOOKBACK_BARS];
        if (then !== null && then > 0) bounced = ((close / then - 1) * 10000) > EXIT_BPS;
      }
      if (trailed || stopped || stale || bounced) {
        lastExitSeq = i;
        entrySeq = -1;
        const sell: SellInput = { side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    // Flat: consider an entry.
    const scored = i - state.warmupBars;
    if (scored >= WINDOW_BARS - NO_ENTRY_TAIL_BARS) return [];
    if (i - lastExitSeq < COOLDOWN_BARS) return [];
    if (i < LOOKBACK_BARS) return [];
    const then = closes[i - LOOKBACK_BARS];
    if (then === null || then <= 0) return [];
    const retBps = (close / then - 1) * 10000;
    if (retBps >= ENTRY_BPS) return [];

    // Buy with all cash, capped by the weight room (100% of equity here).
    const { caps, fees } = state.hello;
    let slice = state.cash;
    const byWeight = state.weightRoom(symbol);
    if (slice > byWeight) slice = byWeight;
    if (slice <= 0n || slice < BigInt(fees.min_notional_quote_units)) return [];
    peak = close;
    entrySeq = i;
    const buy: BuyInput = { side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});
