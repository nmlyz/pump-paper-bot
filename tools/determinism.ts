// Determinism check: run the strategy twice over the dev window and compare
// the full action log (every reply's orders) byte for byte.
import { createHash } from 'node:crypto';
import { createStrategy, DEFAULT_PARAMS } from '../strategy.ts';
import { loadDatasetParts, makeHello, phaseSeed, simulate } from './sim.ts';

const kit = process.argv[2]!;
const ds = loadDatasetParts(kit, false);
const hello = makeHello(phaseSeed('pilot-pumpfun-replay', 'dev', ds.sha256));
const run = () => {
  const lines: string[] = [];
  const r = simulate(ds, hello, createStrategy(DEFAULT_PARAMS), {
    onOrders: (seq, orders) => lines.push(JSON.stringify({ seq, orders })),
  });
  return { hash: createHash('sha256').update(lines.join('\n')).digest('hex'), lines: lines.length, net: r.netPnl };
};
const a = run();
const b = run();
console.log(`run1 ${a.hash} replies ${a.lines} net ${a.net}`);
console.log(`run2 ${b.hash} replies ${b.lines} net ${b.net}`);
console.log(a.hash === b.hash && a.net === b.net ? 'DETERMINISTIC: action logs match byte for byte' : 'NON-DETERMINISTIC!');
