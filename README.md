# Pump Paper Bot

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/nmlyz/pump-paper-bot/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/nmlyz/pump-paper-bot/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A trading bot for the pump.fun bonding-curve replay. It trades 10 SOL of paper
money on a 24-hour replay of recorded pump.fun activity: no real funds move,
every order is paper.

## Strategy

One idea, executed well. A fresh curve pumps on launch, then usually dumps.
The bot buys the dip — a price 25% below the running high, on a young curve
(5–100 slots old) holding at least 2 SOL of real reserves, with a few distinct
buyers and the creator not selling — and rides the bounce with a tight trailing
stop. Losers are cut at −3%, winners are trailed at 3% off the peak once up
4%, and no position is held past 50 slots. Buys respect the 1%-of-real-reserve
size cap and the 5-open-position limit; sells are always for the whole position.

Buying the launch itself, chasing breakouts, and riding curves toward
completion were all measured on the development window and lose money after
fees, so the bot does none of them. See `STRATEGY.md` for the numbers.

## Determinism

The bot is a pure function of the batches it is fed: no clock, no randomness,
no I/O. Two runs over the same window produce byte-identical action logs
(checked with `node tools/determinism.ts`).

## Layout

- `main.ts` — entrypoint: speaks `agent-fun/replay/v2` on stdin/stdout.
- `strategy.ts` — the dip-buying strategy and its parameters.
- `vendor/makefun-bot.ts` — the protocol shim (vendored from the kit).
- `tools/` — offline research tools: `sim.ts` (a port of the replay market
  model), `backtest.ts`, `sweep.ts`, `determinism.ts`. Development aids only;
  the grader runs `main.ts`.

## Backtest

```sh
node tools/backtest.ts <kit dir>          # dev window
node tools/backtest.ts <kit dir> --allparts  # full 24 h
```

Dev window (default fail draw): net **+0.007145 SOL**, 52 fills, 26 coins
(26 round trips of at least 0.01 SOL), max drawdown 0.34%. The same window
scores −0.135 SOL for the sniper pilot, −1.779 SOL for reversion, −9.384 SOL
for momentum, −0.017 SOL for equal-weight, and 0 for hold-cash.

## License

MIT. See `LICENSE`.
