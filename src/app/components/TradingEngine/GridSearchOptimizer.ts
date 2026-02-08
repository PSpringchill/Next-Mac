import { MarketData, BacktestResult, Trade } from '@tradingEngine/types';

// ─── Grid Search Parameter Space ─────────────────────────────────────────────
export interface GridParams {
  tpPct: number;   // Take-profit %  (e.g. 0.1 = 0.1%)
  slPct: number;   // Stop-loss %    (e.g. 0.05 = 0.05%)
  entryObi: number; // Min |OBI| to enter (order book imbalance threshold)
}

export interface GridSearchResult {
  best: GridParams & { score: number };
  bestMetrics: BacktestResult;
  all: GridCellResult[];
  totalCombinations: number;
  elapsed: number;
}

export interface GridCellResult {
  params: GridParams;
  metrics: BacktestResult;
  score: number;
}

// ─── Configurable parameter ranges ───────────────────────────────────────────
export interface GridRanges {
  tpPcts: number[];
  slPcts: number[];
  entryObis: number[];
}

const DEFAULT_RANGES: GridRanges = {
  tpPcts:    [0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1.0],
  slPcts:    [0.03, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5],
  entryObis: [3, 5, 10, 15, 20, 30],
};

// ─── Fast TP/SL Backtester (no ML, no execution engine, pure price sim) ─────
function computeOBI(orderBook: MarketData['orderBook']): number {
  const depth = Math.min(5, orderBook.bids.length, orderBook.asks.length);
  let bidVol = 0, askVol = 0;
  for (let i = 0; i < depth; i++) {
    bidVol += parseFloat(orderBook.bids[i]?.[1] ?? '0');
    askVol += parseFloat(orderBook.asks[i]?.[1] ?? '0');
  }
  const total = bidVol + askVol;
  return total > 0 ? ((bidVol - askVol) / total) * 100 : 0; // -100 to +100
}

function runTPSLBacktest(data: MarketData[], params: GridParams): BacktestResult {
  const { tpPct, slPct, entryObi } = params;
  const trades: Trade[] = [];
  const initialCapital = 100000;
  let capital = initialCapital;
  let i = 0;

  while (i < data.length) {
    const tick = data[i];
    const obi = computeOBI(tick.orderBook);

    // ── Entry condition: |OBI| exceeds threshold ──
    let direction: 1 | -1 | 0 = 0;
    if (obi >= entryObi) direction = 1;       // bullish imbalance → long
    else if (obi <= -entryObi) direction = -1; // bearish imbalance → short

    if (direction === 0) { i++; continue; }

    const entryPrice = tick.price;
    const positionSize = (capital * 0.1) / entryPrice; // 10% of capital
    const tpPrice = direction === 1
      ? entryPrice * (1 + tpPct / 100)
      : entryPrice * (1 - tpPct / 100);
    const slPrice = direction === 1
      ? entryPrice * (1 - slPct / 100)
      : entryPrice * (1 + slPct / 100);

    // Record BUY entry
    trades.push({
      type: direction === 1 ? 'BUY' : 'SELL',
      price: entryPrice,
      size: positionSize,
      timestamp: tick.timestamp,
      pnl: 0,
    });

    // ── Scan forward for TP or SL hit ──
    let exitPrice = entryPrice;
    let exitReason: 'TP' | 'SL' | 'END' = 'END';
    let j = i + 1;

    for (; j < data.length; j++) {
      const price = data[j].price;
      if (direction === 1) {
        if (price >= tpPrice) { exitPrice = tpPrice; exitReason = 'TP'; break; }
        if (price <= slPrice) { exitPrice = slPrice; exitReason = 'SL'; break; }
      } else {
        if (price <= tpPrice) { exitPrice = tpPrice; exitReason = 'TP'; break; }
        if (price >= slPrice) { exitPrice = slPrice; exitReason = 'SL'; break; }
      }
    }

    // If no TP/SL hit, close at last price
    if (exitReason === 'END' && j >= data.length) {
      exitPrice = data[data.length - 1].price;
    }

    const pnl = direction === 1
      ? positionSize * (exitPrice - entryPrice)
      : positionSize * (entryPrice - exitPrice);

    capital += pnl;

    // Record exit
    trades.push({
      type: direction === 1 ? 'SELL' : 'BUY',
      price: exitPrice,
      size: positionSize,
      timestamp: j < data.length ? data[j].timestamp : data[data.length - 1].timestamp,
      pnl,
    });

    // Jump past the exit tick to avoid overlapping trades
    i = j + 1;
  }

  return calculateMetrics(trades, capital, initialCapital);
}

function calculateMetrics(trades: Trade[], finalCapital: number, initialCapital: number): BacktestResult {
  const totalReturn = (finalCapital - initialCapital) / initialCapital;

  // Only count exit trades (those with pnl !== 0 or explicit exits)
  const exitTrades = trades.filter(t => t.pnl !== 0);
  const returns = exitTrades.map(t => t.pnl! / initialCapital);

  const avgReturn = returns.length > 0
    ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  const returnStd = returns.length > 0
    ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length) : 0.01;
  const sharpeRatio = avgReturn / (returnStd || 0.01);

  // Max drawdown from equity curve
  let maxDrawdown = 0;
  let peak = initialCapital;
  let running = initialCapital;
  for (const t of exitTrades) {
    running += t.pnl!;
    if (running > peak) peak = running;
    else {
      const dd = (peak - running) / peak;
      maxDrawdown = Math.max(maxDrawdown, dd);
    }
  }

  const wins = exitTrades.filter(t => t.pnl! > 0);
  const losses = exitTrades.filter(t => t.pnl! < 0);
  const winRate = exitTrades.length > 0 ? wins.length / exitTrades.length : 0;

  // Profit factor
  const grossProfit = wins.reduce((s, t) => s + t.pnl!, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl!, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  return {
    totalReturn,
    sharpeRatio,
    maxDrawdown,
    winRate,
    trades,
  };
}

// ─── Scoring function: weighted composite of metrics ─────────────────────────
function scoreResult(m: BacktestResult): number {
  const exitTrades = m.trades.filter(t => t.pnl !== 0);
  if (exitTrades.length < 3) return -Infinity; // need minimum trades

  const wins = exitTrades.filter(t => t.pnl! > 0);
  const losses = exitTrades.filter(t => t.pnl! < 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl!, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl!, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 10 : 0;

  // Composite score: Sharpe-like return/risk + bonus for high win rate + profit factor
  return (
    m.totalReturn * 100 * 2      // reward return
    + m.sharpeRatio * 1.5        // reward risk-adjusted return
    + m.winRate * 10             // reward consistency
    + Math.min(profitFactor, 5)  // cap profit factor contribution
    - m.maxDrawdown * 100 * 3   // penalize drawdown
  );
}

// ─── Main Grid Search Optimizer ──────────────────────────────────────────────
class GridSearchOptimizer {
  private ranges: GridRanges;

  constructor(ranges?: Partial<GridRanges>) {
    this.ranges = { ...DEFAULT_RANGES, ...ranges };
  }

  run(data: MarketData[]): GridSearchResult {
    const t0 = performance.now();
    const results: GridCellResult[] = [];

    for (const tpPct of this.ranges.tpPcts) {
      for (const slPct of this.ranges.slPcts) {
        for (const entryObi of this.ranges.entryObis) {
          const params: GridParams = { tpPct, slPct, entryObi };
          const metrics = runTPSLBacktest(data, params);
          const score = scoreResult(metrics);
          results.push({ params, metrics, score });
        }
      }
    }

    // Sort descending by score
    results.sort((a, b) => b.score - a.score);

    const best = results[0];
    const elapsed = performance.now() - t0;

    return {
      best: { ...best.params, score: best.score },
      bestMetrics: best.metrics,
      all: results,
      totalCombinations: results.length,
      elapsed,
    };
  }
}

export default GridSearchOptimizer;
export { runTPSLBacktest, scoreResult, computeOBI, DEFAULT_RANGES };
