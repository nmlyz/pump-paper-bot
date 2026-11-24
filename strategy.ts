// Pump Paper Bot: dip-buying on pump.fun bonding curves.
//
// One idea, executed well. A fresh curve pumps on launch, then usually dumps.
// The bounce after a 25% dip off the running high is the one repeatable edge in
// the dev window: coins that dipped 25% (age 5-150 slots, real SOL >= 2, a few
// distinct buyers, creator not selling) bounce often enough that a tight stop
// (5%) plus a tight trailing stop (4% off the peak once up 8%) beats the fees,
// while buying the launch itself or chasing breakouts loses on every exit
// policy tried. So the bot does only this: buy the dip, ride the bounce with
// the trailing stop, cut the rest at -5%, never hold past 50 slots, and add
// into the bounce only while the price keeps stepping up.
//
// Pure function of the batches the harness sends (no clock, no randomness, no
// I/O), so the two graded executions produce byte-identical action logs.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Dip: enter when the price is at most this share of the running high. */
  dipShare: number;
  /** Entry window in slots since CreateEvent. */
  minAge: number;
  maxAge: number;
  /** Real SOL reserve floor at entry (liquidity: the 1% buy cap must allow a real buy). */
  minRq: number;
  /** Distinct non-creator buyers seen before entry. */
  minBuyers: number;
  /** SOL to put into one position in total. */
  stake: number;
  /** First buy of a position (SOL); adds top it up to stake. */
  initial: number;
  /** Most adds per position. */
  maxAdds: number;
  /** Add while the price is at least this far above the last buy's decision price (negative: at most this far below). */
  addStep: number;
  /** Smallest buy worth sending (tx fees are 105k lamports per order). */
  minBuySol: number;
  /** Slippage on buys (bps); sells always go out at 10000. */
  buySlipBps: number;
  /** Stop loss / trailing stop / trailing arm (fractions of cost / peak value). */
  stopLoss: number;
  trail: number;
  trailArm: number;
  /** Exit after this many slots held. */
  maxHold: number;
  /** Exit when the creator sells while held. */
  exitOnDevSell: boolean;
  /** Exit on any single recorded sell of at least this many SOL. */
  bigSellSol: number;
  /** Slots to wait after an exit before the same curve may be bought again. */
  cooldown: number;
  /** Most entries per curve over the run. */
  maxEntries: number;
  /** The running high must have been set within this many slots (0 = off): a dip off a fresh high is a live coin, off a stale high is a dead one. */
  highAgeMax: number;
  /** Most SOL at cost across all positions at once (a drawdown guard). */
  maxExposureSol: number;
}

export const DEFAULT_PARAMS: Params = {
  dipShare: 0.75,
  minAge: 5,
  maxAge: 100,
  minRq: 2,
  minBuyers: 3,
  stake: 0.15,
  initial: 0.05,
  addStep: 0.03,
  maxAdds: 0,
  minBuySol: 0.01,
  buySlipBps: 500,
  stopLoss: 0.03,
  trail: 0.03,
  trailArm: 0.04,
  maxHold: 50,
  exitOnDevSell: true,
  bigSellSol: 5,
  cooldown: 50,
  maxEntries: 1,
  highAgeMax: 0,
  maxExposureSol: 8,
};

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125;

interface Trade {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
  price: number;
}

interface Tape {
  created: number | null;
  creator: string;
  trades: Trade[];
  /** Highest price seen since creation. */
  high: number;
  /** Slot the running high was set. */
  highSlot: number;
  buyers: Set<string>;
  entries: number;
  lastExit: number;
  devSold: boolean;
}

interface Held {
  opened: number;
  peakValue: number;
  invested: number;
  adds: number;
  exiting: boolean;
  filled: boolean;
  lastAddPrice: number;
  lastValue: number;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();

  const tapeOf = (mint: Pubkey): Tape => {
    let t = tapes.get(mint);
    if (t === undefined) {
      t = { created: null, creator: '', trades: [], high: 0, highSlot: -1e12, buyers: new Set(), entries: 0, lastExit: -1e12, devSold: false };
      tapes.set(mint, t);
    }
    return t;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const bigSell = new Set<Pubkey>();
      const traded: Pubkey[] = [];
      for (const e of batch.events) {
        if (e.event === 'CreateEvent') {
          const t = tapeOf(e.mint);
          t.created = e.slot;
          t.creator = e.creator;
        } else if (e.event === 'TradeEvent') {
          const t = tapeOf(e.mint);
          const sol = Number(e.sol_amount) / LAMPORTS;
          const price = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
          t.trades.push({ slot: e.slot, buy: e.is_buy, sol, user: e.user, price });
          if (t.trades.length > 3000) t.trades.splice(0, t.trades.length - 3000);
          if (price > t.high) {
            t.high = price;
            t.highSlot = e.slot;
          }
          if (e.is_buy && e.user !== t.creator) t.buyers.add(e.user);
          if (!traded.includes(e.mint)) traded.push(e.mint);
          if (!e.is_buy && e.user === t.creator) t.devSold = true;
          if (!e.is_buy && sol >= p.bigSellSol) bigSell.add(e.mint);
        }
      }
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;

      // Liquidation value of a position in SOL (curve + tx fees deducted).
      const valueOf = (mint: Pubkey): number => {
        const pos = state.positions.get(mint);
        if (pos === undefined) return 0;
        const curve = state.curves.get(mint);
        if (curve === undefined) return 0;
        const mk = marks.get(mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const tokens = Number(pos.token_amount);
        return ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - CURVE_FEE) - tx;
      };

      // Exits first.
      for (const [mint, h] of held) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) {
            held.delete(mint);
            const t = tapeOf(mint);
            if (h.filled) t.lastExit = now;
            else t.entries--;
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const value = valueOf(mint);
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value > h.peakValue) h.peakValue = value;
        h.lastValue = value;
        let exit = h.exiting;
        if (!exit && value < cost * (1 - p.stopLoss)) exit = true;
        if (!exit && h.peakValue >= cost * (1 + p.trailArm) && value < h.peakValue * (1 - p.trail)) exit = true;
        if (!exit && bigSell.has(mint)) exit = true;
        if (!exit && p.exitOnDevSell && tapeOf(mint).devSold) exit = true;
        if (!exit && now - h.opened > p.maxHold) exit = true;
        if (!exit) continue;
        h.exiting = true;
        if (pendingByMint.has(mint)) {
          let sellPending = false;
          for (const po of state.pending.values()) if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
          if (sellPending) continue;
        }
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      }

      // Entries and adds.
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let exposure = 0;
      for (const [mint, h] of held) exposure += Math.max(h.invested, Number(state.positions.get(mint)?.cost_lamports ?? 0n) / LAMPORTS);
      for (const mint of traded) {
        if (orders.length >= cap) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (pendingByMint.has(mint)) continue;
        const t = tapes.get(mint)!;
        const h = held.get(mint);
        const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        let want = 0;
        if (h === undefined) {
          if (slotsLeft <= 0) continue;
          if (t.entries >= p.maxEntries || now - t.lastExit < p.cooldown) continue;
          if (t.created === null || now - t.created < p.minAge || now - t.created > p.maxAge) continue;
          if (t.devSold || t.buyers.size < p.minBuyers) continue;
          if (rqSol < p.minRq) continue;
          if (t.high <= 0 || price > t.high * p.dipShare) continue;
          if (p.highAgeMax > 0 && now - t.highSlot > p.highAgeMax) continue;
          want = Math.min(p.initial, p.stake);
        } else {
          // Add into the bounce only: price stepped up from the last buy, still room to stake.
          if (h.exiting || !h.filled || h.adds >= p.maxAdds || h.invested >= p.stake - p.minBuySol) continue;
          const pos = state.positions.get(mint);
          if (pos === undefined) continue;
          if (price < h.lastAddPrice * (1 + p.addStep)) continue;
          want = Math.min(p.stake - h.invested, p.initial);
        }
        const capSol = Math.floor(Number(state.maxBuyLamports(mint)) * 0.97) / LAMPORTS;
        let amount = Math.min(capSol, want, p.maxExposureSol - exposure);
        if (amount > free - tx) amount = free - tx;
        if (amount < p.minBuySol) continue;
        const lamports = BigInt(Math.floor(amount * LAMPORTS));
        orders.push({ side: 'buy', mint, quote_lamports: lamports, max_slippage_bps: p.buySlipBps });
        free -= amount + tx;
        exposure += amount;
        if (h === undefined) {
          held.set(mint, { opened: now, peakValue: 0, invested: amount, adds: 0, exiting: false, filled: false, lastAddPrice: price, lastValue: 0 });
          t.entries++;
          slotsLeft--;
        } else {
          h.invested += amount;
          h.adds++;
          h.lastAddPrice = price;
        }
      }
      return orders;
    },
  };
}
