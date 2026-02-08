import { MarketData, BacktestResult, Trade } from '@tradingEngine/types';

// ─── Grid Search Parameter Space ─────────────────────────────────────────────
export interface GridParams {
  tpPct: number;   // Take-profit %  (e.g. 0.1 = 0.1%)
  slPct: number;   // Stop-loss %    (e.g. 0.05 = 0.05%)
  entryObi: number; // Min |OBI| to enter (order book imbalance threshold)
}

export interface ValidationResult {
  passed: boolean;
  sanity: boolean;
  plausibility: boolean;
  smoothness: number;
  wfvScore: number;
  wfvPassed: boolean;
  reasons: string[];
}

export interface GridSearchResult {
  best: GridParams & { score: number };
  bestMetrics: BacktestResult;
  all: GridCellResult[];
  totalCombinations: number;
  elapsed: number;
  stage1Count: number;
  stage2Count: number;
  validatedCount: number;
  rejectedCount: number;
}

export interface DirectionalStats {
  buyTrades: number;
  buyWins: number;
  buyWinRate: number;
  sellTrades: number;
  sellWins: number;
  sellWinRate: number;
}

export interface GridCellResult {
  params: GridParams;
  metrics: BacktestResult;
  directional: DirectionalStats;
  score: number;
  validation?: ValidationResult;
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

    // Record entry
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

function calculateDirectionalStats(trades: Trade[]): DirectionalStats {
  let buyTrades = 0, buyWins = 0, sellTrades = 0, sellWins = 0;

  // Trades come in entry/exit pairs
  for (let i = 0; i < trades.length - 1; i += 2) {
    const entry = trades[i];
    const exit = trades[i + 1];
    if (!exit) break;

    if (entry.type === 'BUY') {
      buyTrades++;
      if ((exit.pnl ?? 0) > 0) buyWins++;
    } else {
      sellTrades++;
      if ((exit.pnl ?? 0) > 0) sellWins++;
    }
  }

  return {
    buyTrades,
    buyWins,
    buyWinRate: buyTrades > 0 ? buyWins / buyTrades : 0,
    sellTrades,
    sellWins,
    sellWinRate: sellTrades > 0 ? sellWins / sellTrades : 0,
  };
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

// ─── Anti-Overfitting Validation Engine ──────────────────────────────────────
const VALIDATION_THRESHOLDS = {
  minTrades: 5,
  maxSharpe: 3.5,
  maxProfitFactor: 4.0,
  minSmoothness: 0.80,
  wfvFolds: 5,
  wfvMinPassFolds: 3,
  wfvDegradationTol: 0.6,
};

function computeEquitySmoothness(trades: Trade[], initialCapital: number): number {
  const exitTrades = trades.filter(t => t.pnl !== 0);
  if (exitTrades.length < 5) return 0;

  const equity: number[] = [];
  let running = initialCapital;
  for (const t of exitTrades) {
    running += t.pnl!;
    equity.push(running);
  }

  const period = Math.min(5, Math.floor(equity.length / 2));
  if (period < 2) return 1;

  const sma: number[] = [];
  for (let i = period - 1; i < equity.length; i++) {
    let sum = 0;
    for (let k = i - period + 1; k <= i; k++) sum += equity[k];
    sma.push(sum / period);
  }

  const equitySlice = equity.slice(period - 1);
  const n = Math.min(equitySlice.length, sma.length);
  if (n < 3) return 1;

  const meanE = equitySlice.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const meanS = sma.slice(0, n).reduce((s, v) => s + v, 0) / n;

  let covES = 0, varE = 0, varS = 0;
  for (let i = 0; i < n; i++) {
    const de = equitySlice[i] - meanE;
    const ds = sma[i] - meanS;
    covES += de * ds;
    varE += de * de;
    varS += ds * ds;
  }

  const denom = Math.sqrt(varE * varS);
  return denom > 0 ? covES / denom : 0;
}

// ─── Walk-Forward Validation ─────────────────────────────────────────────────
function runWalkForwardValidation(data: MarketData[], params: GridParams): { wfvScore: number; wfvPassed: boolean } {
  const K = VALIDATION_THRESHOLDS.wfvFolds;
  const foldSize = Math.floor(data.length / K);

  if (foldSize < 10) return { wfvScore: 0, wfvPassed: false };

  let passedFolds = 0;
  let totalRatio = 0;

  for (let fold = 0; fold < K; fold++) {
    const oosStart = fold * foldSize;
    const oosEnd = fold === K - 1 ? data.length : (fold + 1) * foldSize;

    const isData = [...data.slice(0, oosStart), ...data.slice(oosEnd)];
    const oosData = data.slice(oosStart, oosEnd);

    if (isData.length < 10 || oosData.length < 5) continue;

    const isResult = runTPSLBacktest(isData, params);
    const oosResult = runTPSLBacktest(oosData, params);

    const isReturn = isResult.totalReturn;
    const oosReturn = oosResult.totalReturn;

    let foldPassed = false;
    if (isReturn > 0) {
      foldPassed = oosReturn >= isReturn * VALIDATION_THRESHOLDS.wfvDegradationTol;
    } else {
      foldPassed = oosReturn >= isReturn * (2 - VALIDATION_THRESHOLDS.wfvDegradationTol);
    }

    if (foldPassed) passedFolds++;
    totalRatio += isReturn !== 0 ? oosReturn / isReturn : (oosReturn >= 0 ? 1 : 0);
  }

  const wfvScore = K > 0 ? totalRatio / K : 0;
  const wfvPassed = passedFolds >= VALIDATION_THRESHOLDS.wfvMinPassFolds;

  return { wfvScore, wfvPassed };
}

function validateVariant(metrics: BacktestResult, data: MarketData[], params: GridParams): ValidationResult {
  const reasons: string[] = [];
  const exitTrades = metrics.trades.filter(t => t.pnl !== 0);

  const sanity = exitTrades.length >= VALIDATION_THRESHOLDS.minTrades;
  if (!sanity) reasons.push(`Trades ${exitTrades.length} < ${VALIDATION_THRESHOLDS.minTrades}`);

  const wins = exitTrades.filter(t => t.pnl! > 0);
  const losses = exitTrades.filter(t => t.pnl! < 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl!, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl!, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 10 : 0;

  const sharpePlausible = Math.abs(metrics.sharpeRatio) <= VALIDATION_THRESHOLDS.maxSharpe;
  const pfPlausible = profitFactor <= VALIDATION_THRESHOLDS.maxProfitFactor;
  const plausibility = sharpePlausible && pfPlausible;
  if (!sharpePlausible) reasons.push(`Sharpe ${metrics.sharpeRatio.toFixed(2)} > ${VALIDATION_THRESHOLDS.maxSharpe}`);
  if (!pfPlausible) reasons.push(`PF ${profitFactor.toFixed(2)} > ${VALIDATION_THRESHOLDS.maxProfitFactor}`);

  const smoothness = computeEquitySmoothness(metrics.trades, 100000);
  const smoothnessPassed = smoothness >= VALIDATION_THRESHOLDS.minSmoothness;
  if (!smoothnessPassed) reasons.push(`Smoothness ${smoothness.toFixed(3)} < ${VALIDATION_THRESHOLDS.minSmoothness}`);

  const { wfvScore, wfvPassed } = runWalkForwardValidation(data, params);
  if (!wfvPassed) reasons.push(`WFV score ${wfvScore.toFixed(3)}`);

  const passed = sanity && plausibility && smoothnessPassed && wfvPassed;

  return { passed, sanity, plausibility, smoothness, wfvScore, wfvPassed, reasons };
}

// ─── Micro-grid step generator for Stage 2 refinement ────────────────────────
function generateMicroSteps(center: number, step: number, minVal: number, maxVal: number): number[] {
  const steps: number[] = [];
  for (let delta = -3; delta <= 3; delta++) {
    const val = Math.round((center + delta * step) * 1000) / 1000;
    if (val >= minVal && val <= maxVal) steps.push(val);
  }
  return steps;
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

// ─── Main Grid Search Optimizer (Two-Stage + Validation) ────────────────────
class GridSearchOptimizer {
  private ranges: GridRanges;

  constructor(ranges?: Partial<GridRanges>) {
    this.ranges = { ...DEFAULT_RANGES, ...ranges };
  }

  run(data: MarketData[]): GridSearchResult {
    const t0 = performance.now();

    // ── Stage 1: Coarse grid search ──
    const stage1Results = this.runCoarseGrid(data);
    const stage1Count = stage1Results.length;

    // ── Stage 2: Fine refinement around top 5 ──
    const topN = stage1Results.slice(0, 5);
    const stage2Results = this.runRefinement(data, topN, stage1Results);
    const stage2Count = stage2Results.length;

    // ── Merge & sort ──
    const allResults = [...stage1Results, ...stage2Results];
    allResults.sort((a, b) => b.score - a.score);

    // ── Validate top 20 candidates (anti-overfitting gauntlet) ──
    let validatedCount = 0;
    let rejectedCount = 0;
    const validateN = Math.min(20, allResults.length);
    for (let i = 0; i < validateN; i++) {
      allResults[i].validation = validateVariant(allResults[i].metrics, data, allResults[i].params);
      if (allResults[i].validation!.passed) validatedCount++;
      else rejectedCount++;
    }

    // Best = highest scoring that passed validation, or highest overall
    const validated = allResults.filter(r => r.validation?.passed);
    const best = validated.length > 0 ? validated[0] : allResults[0];

    const elapsed = performance.now() - t0;

    return {
      best: { ...best.params, score: best.score },
      bestMetrics: best.metrics,
      all: allResults,
      totalCombinations: allResults.length,
      elapsed,
      stage1Count,
      stage2Count,
      validatedCount,
      rejectedCount,
    };
  }

  private runCoarseGrid(data: MarketData[]): GridCellResult[] {
    const results: GridCellResult[] = [];
    for (const tpPct of this.ranges.tpPcts) {
      for (const slPct of this.ranges.slPcts) {
        for (const entryObi of this.ranges.entryObis) {
          const params: GridParams = { tpPct, slPct, entryObi };
          const metrics = runTPSLBacktest(data, params);
          const directional = calculateDirectionalStats(metrics.trades);
          const score = scoreResult(metrics);
          results.push({ params, metrics, directional, score });
        }
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  private runRefinement(data: MarketData[], topResults: GridCellResult[], coarseResults: GridCellResult[]): GridCellResult[] {
    const refined: GridCellResult[] = [];
    const tested = new Set<string>();

    // Mark all coarse grid points as already tested
    for (const r of coarseResults) {
      tested.add(`${r.params.tpPct}|${r.params.slPct}|${r.params.entryObi}`);
    }

    for (const top of topResults) {
      const { tpPct, slPct, entryObi } = top.params;

      const tpSteps = generateMicroSteps(tpPct, 0.025, 0.01, 2.0);
      const slSteps = generateMicroSteps(slPct, 0.015, 0.01, 1.0);
      const obiSteps = generateMicroSteps(entryObi, 2, 1, 50);

      for (const tp of tpSteps) {
        for (const sl of slSteps) {
          for (const obi of obiSteps) {
            const key = `${tp}|${sl}|${obi}`;
            if (tested.has(key)) continue;
            tested.add(key);

            const params: GridParams = { tpPct: tp, slPct: sl, entryObi: obi };
            const metrics = runTPSLBacktest(data, params);
            const directional = calculateDirectionalStats(metrics.trades);
            const score = scoreResult(metrics);
            refined.push({ params, metrics, directional, score });
          }
        }
      }
    }

    return refined;
  }
}

export default GridSearchOptimizer;
export { runTPSLBacktest, scoreResult, computeOBI, computeEquitySmoothness, validateVariant, DEFAULT_RANGES, VALIDATION_THRESHOLDS };
