# Strategy

## What the bot does

Dip-buying on pump.fun bonding curves, one leg only.

**Entry.** A curve is bought when all of these hold on a batch:

- age 5–100 slots since its CreateEvent;
- price at most 75% of the running high since creation (a 25% dip);
- real SOL reserves at least 2;
- at least 3 distinct non-creator buyers seen;
- the creator has not sold.

Buy size is the 1%-of-real-reserve cap (97% of it, for margin), up to 0.05 SOL
for the first buy, at most 0.15 SOL per position. Buys use 500 bps of slippage
tolerance; sells always use 10000 bps so a sale is never refused for the price
moving in the 2-slot latency.

**Exits.** The whole position is sold on the first of:

- value below cost × 0.97 (stop loss);
- value below peak × 0.97 once the peak reached cost × 1.04 (trailing stop);
- the creator sells while held, or a single recorded sell of 5+ SOL lands;
- 50 slots held.

No fixed take-profit: the trailing stop takes what the bounce gives. No
pyramiding: adds into a falling dip lost money in backtests.

## What was measured, and why the alternatives were dropped

All numbers are net PnL in SOL on the kit's development window (part-00000,
430 coins, 50,000 events), from the local replay-model port in `tools/sim.ts`,
unless noted. Fees are 95 + 30 bps of curve fees plus 105,000 lamports per
order; the failed-transaction draw uses the pilot's dev seed.

- **Buy the launch (sniper pilot, default params):** −0.135 SOL, 136 coins.
  By the time a fill lands 2 slots after the CreateEvent, the median coin is
  already +17% over its create price; the pump is gone before the bot can buy
  it. Only 13% of coins run a further +15% in the next 50 slots.
- **Traction momentum (momentum pilot, default params):** −9.384 SOL,
  max drawdown 95%. Pyramiding 2 SOL into runners that mostly dump.
- **Mean reversion (reversion pilot, default params):** −1.779 SOL.
  Buying 30–45% dips from a 2500-slot high catches falling knives.
- **Completion chase:** un-capturable. Every curve that completes in the dev
  window completes in the same slot it is created (real SOL 0 → 85 in one
  trade); there is no trade 2+ slots before completion with real SOL above
  10, so no buy can be placed ahead of the migration.
- **Breakout (new high after age 50):** about −2% expected value per trade
  offline; buying a recovery back to 85% of the high after a dip: −10%.

The dip-buy, measured offline on the trade-price series and then in the full
replay model:

- 25% dip, age 5–150, real SOL ≥ 2, no fixed take-profit, stop 5%, trail 4–5%,
  hold ≤ 50 slots: about +4–5% expected value per trade offline, but only
  ~35 trades and the edge concentrates in a few big bounces.
- In the replay model the same rule earns less: the 1% size cap holds buys to
  ~0.02 SOL at 2 SOL of reserves, so the fixed 105,000-lamport tx fee is ~1%
  of each buy, and fills land 2 slots after the decision, after the dip has
  often already started bouncing or kept falling.

Final settings (tuned by grid sweep on the replay model, preferring flat
regions over single best cells, scored as the mean over 4 failed-tx draws):
dip 25%, age 5–100, real SOL ≥ 2, buyers ≥ 3, stop 3%, trail 3% (arm 4%),
hold ≤ 50 slots, one entry per coin, buy slippage 500 bps.

## Results

Development window, default fail draw:

| bot | net PnL (SOL) | fills | coins | max DD |
| --- | --- | --- | --- | --- |
| pump-paper-bot (this) | **+0.007145** | 52 | 26 | 0.0034 |
| sniper pilot | −0.134865 | 412 | 136 | 0.0168 |
| reversion pilot | −1.779377 | 934 | 70 | 0.1818 |
| momentum pilot | −9.383721 | 410 | 48 | 0.9502 |
| equal-weight | −0.016795 | 5 | 5 | 0.0091 |
| hold-cash | 0.000000 | 0 | 0 | 0.0000 |

Guardrails on the dev window: 26 distinct mints with round trips of at least
0.01 SOL (needs 20), max drawdown 0.34% (limit 50%), net PnL above 0. Two
executions produce byte-identical action logs (`tools/determinism.ts`).

Caveats, stated plainly: the edge is thin. The dev net (+0.007 SOL) is small
next to the noise between fail draws, and on the full 24-hour window (all
three dataset parts) the same settings score −0.089 SOL — still the best of
the pilots there (sniper −0.489, momentum −9.387, reversion −4.016), but
negative. The final window is a fresh sample; this bot's expected value there
is around zero, with the same thin edge the dev window shows.
