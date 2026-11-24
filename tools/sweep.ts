// Grid sweep of strategy parameters on the dev window.
//
//   node tools/sweep.ts <kit dir> '<base params json>' '<grid json>' [top N] [--allparts]
//
// Every setting is scored as the mean over 4 fail keys (the final window's
// failed-tx draw is secret), with the worst key and the net without the single
// best round trip printed, so a setting that only wins through one lucky coin
// or one lucky draw stands out.

import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';
import { loadDatasetParts, makeHello, phaseSeed, simulate } from './sim.ts';

const [kit, baseJson, gridJson, topArg] = process.argv.slice(2);
if (kit === undefined || gridJson === undefined) {
  console.error("usage: node tools/sweep.ts <kit dir> '<base json>' '<grid json>' [top] [--allparts]");
  process.exit(2);
}
const base = { ...DEFAULT_PARAMS, ...(JSON.parse(baseJson ?? '{}') as Partial<Params>) };
const grid = JSON.parse(gridJson) as Record<string, unknown[]>;
const allParts = process.argv.includes('--allparts');
const ds = loadDatasetParts(kit, allParts);
const hello = makeHello(phaseSeed('pilot-pumpfun-replay', 'dev', ds.sha256));
const keys = Object.keys(grid);
const combos: Record<string, unknown>[] = [{}];
for (const k of keys) {
  const next: Record<string, unknown>[] = [];
  for (const c of combos) for (const v of grid[k]!) next.push({ ...c, [k]: v });
  combos.splice(0, combos.length, ...next);
}
const FAIL_KEYS = [11n, 22n, 33n, 44n];
const rows: { c: Record<string, unknown>; net: number; worst: number; exBest: number; fills: number; coins: number; big: number; dd: number; trips: number; wins: number }[] = [];
for (const c of combos) {
  let sum = 0;
  let worst = Infinity;
  let exBest = 0;
  let fills = Infinity;
  let coins = Infinity;
  let big = Infinity;
  let dd = 0;
  let trips = 0;
  let wins = 0;
  for (const failKey of FAIL_KEYS) {
    const r = simulate(ds, hello, createStrategy({ ...base, ...c } as Params), { failKey });
    const pnl = r.trips.map((t) => Number(t.pnl) / 1e9).sort((a, b) => b - a);
    const net = Number(r.netPnl) / 1e9;
    sum += net;
    worst = Math.min(worst, net);
    exBest += (net - (pnl[0] ?? 0)) / FAIL_KEYS.length;
    fills = Math.min(fills, r.fills);
    coins = Math.min(coins, r.mints);
    big = Math.min(big, r.bigBuyMints);
    dd = Math.max(dd, r.maxDrawdown);
    trips = r.trips.length;
    wins = r.trips.filter((t) => t.pnl > 0n).length;
  }
  rows.push({ c, net: sum / FAIL_KEYS.length, worst, exBest, fills, coins, big, dd, trips, wins });
}
rows.sort((a, b) => b.net - a.net);
for (const r of rows.slice(0, Number(topArg ?? 20))) {
  console.log(
    `mean ${r.net.toFixed(3)} worst ${r.worst.toFixed(3)} exBest ${r.exBest.toFixed(3)} fills ${r.fills} coins ${r.coins} big ${r.big} trips ${r.trips} wins ${r.wins} dd ${r.dd.toFixed(3)} ${JSON.stringify(r.c)}`,
  );
}
