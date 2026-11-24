// Offline backtest of strategy.ts on the kit's dev window with the local engine
// port (tools/sim.ts, a faithful port of the harness market model).
//
//   node tools/backtest.ts <kit dir> ['{"stakeA":0.2}'] [--allparts] [--trips]
//
// Prints net PnL, fills, coins, round trips >= 0.01 SOL, drawdown and reject
// reasons; --trips lists every round trip. --allparts loads all 3 dataset parts
// (the full 24h) instead of only part-00000 (the dev sample).

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';
import { loadDatasetParts, makeHello, phaseSeed, simulate } from './sim.ts';

const kit = process.argv[2];
if (kit === undefined) {
  console.error('usage: node tools/backtest.ts <kit dir> [params json] [--allparts] [--trips]');
  process.exit(2);
}
const overrides = process.argv[3] !== undefined && process.argv[3].startsWith('{') ? (JSON.parse(process.argv[3]) as Partial<Params>) : {};
const allParts = process.argv.includes('--allparts');
const ds = loadDatasetParts(kit, allParts);
const hello = makeHello(phaseSeed('pilot-pumpfun-replay', 'dev', ds.sha256));
const params = { ...DEFAULT_PARAMS, ...overrides };
const sol = (x: bigint) => (Number(x) / 1e9).toFixed(6);
const show = (label: string, r: ReturnType<typeof simulate>) => {
  const trips = r.trips.map((t) => Number(t.pnl) / 1e9).sort((a, b) => b - a);
  console.log(
    `${label} net ${sol(r.netPnl)} SOL  fills ${r.fills}  coins ${r.mints}  bigBuyCoins ${r.bigBuyMints}  trips ${r.trips.length}  wins ${r.trips.filter((t) => t.pnl > 0n).length}  dd ${r.maxDrawdown.toFixed(4)}  rejected ${r.rejected} ${JSON.stringify(r.rejectReasons)}  failed ${r.failed}`,
  );
  console.log(`  top trips: ${trips.slice(0, 5).map((x) => x.toFixed(3)).join(', ')}  worst: ${trips.slice(-3).map((x) => x.toFixed(3)).join(', ')}  net ex-best: ${(Number(r.netPnl) / 1e9 - (trips[0] ?? 0)).toFixed(3)}`);
  return r;
};
const r = show('dev', simulate(ds, hello, createStrategy(params)));
show('no-fail', simulate(ds, hello, createStrategy(params), { failKey: null }));
show('2x-fees', simulate(ds, hello, createStrategy(params), { feeMultiplier: 2n }));
if (process.argv.includes('--trips')) {
  for (const t of r.trips) console.log(t.mint, t.open, t.close - t.open, sol(t.pnl));
}
