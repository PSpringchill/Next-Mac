// src/tradingEngine/LOBBacktester.ts
// Rolling Window Backtester for LOB ML Strategy
// Implements: 30-min training window / 10-sec test window rolling approach
// as per the "Framework for Limit Order Submission Strategy Using Machine Learning"

import LOBFeatureExtractor, { LOBFeatures } from './LOBFeatureExtractor';
import MLEnsembleTrainer, { ModelSelection, computeMetrics } from './MLEnsembleTrainer';
import { OrderBookData } from '@tradingEngine/types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LOBDataPoint {
  timestamp: number;  // milliseconds
  orderBook: OrderBookData;
  price: number;      // actual mid-price at this point
}

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  direction: 'BUY' | 'SELL';
  prediction: number;
  actual: number;
  pnl: number;
  size: number;
}

export interface WindowResult {
  windowIndex: number;
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  trainSamples: number;
  testSamples: number;
  modelUsed: string;
  modelScore: number;
  testAccuracy: number;
  testPrecision: number;
  testRecall: number;
  testF1: number;
  trades: BacktestTrade[];
  windowPnl: number;
}

export interface BacktestResults {
  totalReturn: number;
  totalPnl: number;
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  winRate: number;
  totalTrades: number;
  profitFactor: number;
  avgTradeReturn: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  avgAccuracy: number;
  windows: WindowResult[];
  trades: BacktestTrade[];
  equityCurve: number[];
  modelUsageCount: Record<string, number>;
  report: string;
}

export interface LOBBacktestConfig {
  trainWindowMs: number;    // Training window in ms (default: 30 min = 1_800_000)
  testWindowMs: number;     // Test window in ms (default: 10 sec = 10_000)
  stepMs: number;           // Step size for rolling (default: same as testWindowMs)
  initialCapital: number;   // Starting capital
  positionSizePct: number;  // % of capital per trade
  stopLossPct: number;      // Stop loss %
  takeProfitPct: number;    // Take profit %
  minConfidence: number;    // Minimum prediction confidence to trade
  maxOpenTrades: number;    // Max concurrent trades
  commissionPct: number;    // Commission per trade %
  slippageBps: number;      // Slippage in basis points
}

const DEFAULT_CONFIG: LOBBacktestConfig = {
  trainWindowMs: 30 * 60 * 1000,   // 30 minutes
  testWindowMs: 10 * 1000,          // 10 seconds
  stepMs: 10 * 1000,                // Step = test window
  initialCapital: 100_000,
  positionSizePct: 2,               // 2% per trade
  stopLossPct: 1,                   // 1% stop loss
  takeProfitPct: 2,                 // 2% take profit
  minConfidence: 0.5,
  maxOpenTrades: 3,
  commissionPct: 0.04,              // 4bps commission
  slippageBps: 1,
};

// ─── LOB Backtester ──────────────────────────────────────────────────────────

class LOBBacktester {
  private config: LOBBacktestConfig;
  private featureExtractor: LOBFeatureExtractor;

  constructor(config: Partial<LOBBacktestConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.featureExtractor = new LOBFeatureExtractor();
  }

  // ─── Main Backtest Entry Point ────────────────────────────────────────────

  async runBacktest(data: LOBDataPoint[]): Promise<BacktestResults> {
    if (data.length < 10) {
      throw new Error(`Not enough data points (${data.length}). Need at least 10.`);
    }

    // Sort data by timestamp
    const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);
    const startTime = sorted[0].timestamp;
    const endTime = sorted[sorted.length - 1].timestamp;

    // Extract features for all data points
    this.featureExtractor.reset();
    const allFeatures: LOBFeatures[] = sorted.map(d =>
      this.featureExtractor.extract(d.orderBook, d.timestamp)
    );
    // Assign labels retroactively
    const labeled = this.featureExtractor.assignLabels(allFeatures);

    // Rolling window iteration
    const windows: WindowResult[] = [];
    const allTrades: BacktestTrade[] = [];
    let capital = this.config.initialCapital;
    const equityCurve: number[] = [capital];
    const modelUsageCount: Record<string, number> = {};

    let windowIdx = 0;
    let windowStart = startTime;

    while (windowStart + this.config.trainWindowMs + this.config.testWindowMs <= endTime) {
      const trainEnd = windowStart + this.config.trainWindowMs;
      const testEnd = trainEnd + this.config.testWindowMs;

      // Split data into train and test by timestamp
      const trainData = this.getDataInRange(labeled, sorted, windowStart, trainEnd);
      const testData = this.getDataInRange(labeled, sorted, trainEnd, testEnd);

      if (trainData.features.length >= 20 && testData.features.length >= 2) {
        // Train ML models with 5-fold CV
        const trainer = new MLEnsembleTrainer({
          nEstimators: 30,
          maxDepth: 5,
          minSamplesLeaf: 3,
          nFolds: Math.min(5, Math.floor(trainData.features.length / 4)),
        });

        const trainX = trainData.features.map(f => this.featureExtractor.toFeatureVector(f));
        const trainY = trainData.features.map(f => f.label);
        const testX = testData.features.map(f => this.featureExtractor.toFeatureVector(f));
        const testY = testData.features.map(f => f.label);

        try {
          const modelSelection = trainer.trainAndSelect({ X: trainX, y: trainY });

          // Predict on test data
          const predictions = trainer.predictBest(testX);
          const testMetrics = computeMetrics(testY, predictions);

          // Track model usage
          modelUsageCount[modelSelection.bestModel] = (modelUsageCount[modelSelection.bestModel] || 0) + 1;

          // Generate trades from predictions
          const trades = this.generateTrades(
            predictions,
            testData.dataPoints,
            capital
          );

          // Update capital
          let windowPnl = 0;
          for (const trade of trades) {
            windowPnl += trade.pnl;
          }
          capital += windowPnl;
          equityCurve.push(capital);

          allTrades.push(...trades);

          windows.push({
            windowIndex: windowIdx,
            trainStart: windowStart,
            trainEnd,
            testStart: trainEnd,
            testEnd,
            trainSamples: trainData.features.length,
            testSamples: testData.features.length,
            modelUsed: modelSelection.bestModel,
            modelScore: modelSelection.bestScore,
            testAccuracy: testMetrics.accuracy,
            testPrecision: testMetrics.precision,
            testRecall: testMetrics.recall,
            testF1: testMetrics.f1,
            trades,
            windowPnl,
          });
        } catch {
          // Skip window if training fails (e.g., not enough unique samples)
        }
      }

      windowStart += this.config.stepMs;
      windowIdx++;
    }

    return this.computeResults(windows, allTrades, equityCurve, modelUsageCount);
  }

  // ─── Generate Synthetic LOB Data ──────────────────────────────────────────
  // For testing the backtester without real exchange data

  generateSyntheticData(
    symbol: string,
    nPoints: number = 1000,
    basePrice: number = 10000,
    volatility: number = 0.001
  ): LOBDataPoint[] {
    const data: LOBDataPoint[] = [];
    let price = basePrice;
    const startTime = Date.now() - nPoints * 1000;

    for (let i = 0; i < nPoints; i++) {
      // Random walk with drift
      const drift = Math.sin(i / 100) * 0.0001;  // Slight cyclical drift
      const noise = (Math.random() - 0.5) * 2 * volatility;
      price *= (1 + drift + noise);

      const spread = price * 0.0002;  // 2bps spread
      const bestBid = price - spread / 2;
      const bestAsk = price + spread / 2;

      // Generate realistic LOB levels
      const bids: [string, string][] = [];
      const asks: [string, string][] = [];

      for (let level = 0; level < 20; level++) {
        const bidPrice = bestBid - level * spread * 0.5;
        const askPrice = bestAsk + level * spread * 0.5;
        // Volume increases with distance from mid (typical LOB shape)
        const bidVol = (1 + level * 0.3 + Math.random() * 2) * 10;
        const askVol = (1 + level * 0.3 + Math.random() * 2) * 10;
        bids.push([bidPrice.toFixed(2), bidVol.toFixed(4)]);
        asks.push([askPrice.toFixed(2), askVol.toFixed(4)]);
      }

      data.push({
        timestamp: startTime + i * 1000,  // 1 second apart
        orderBook: { lastUpdateId: i, bids, asks },
        price,
      });
    }

    return data;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private getDataInRange(
    features: LOBFeatures[],
    dataPoints: LOBDataPoint[],
    startMs: number,
    endMs: number
  ): { features: LOBFeatures[]; dataPoints: LOBDataPoint[] } {
    const filteredFeatures: LOBFeatures[] = [];
    const filteredData: LOBDataPoint[] = [];

    for (let i = 0; i < features.length; i++) {
      if (features[i].timestamp >= startMs && features[i].timestamp < endMs) {
        filteredFeatures.push(features[i]);
        filteredData.push(dataPoints[i]);
      }
    }

    return { features: filteredFeatures, dataPoints: filteredData };
  }

  private generateTrades(
    predictions: number[],
    dataPoints: LOBDataPoint[],
    capital: number
  ): BacktestTrade[] {
    const trades: BacktestTrade[] = [];
    const positionSize = capital * (this.config.positionSizePct / 100);

    for (let i = 0; i < predictions.length - 1; i++) {
      const pred = predictions[i];
      const entryPoint = dataPoints[i];
      const exitPoint = dataPoints[Math.min(i + 1, dataPoints.length - 1)];

      const direction: 'BUY' | 'SELL' = pred === 1 ? 'BUY' : 'SELL';
      const entryPrice = entryPoint.price;
      const exitPrice = exitPoint.price;

      // Apply slippage
      const slippage = entryPrice * (this.config.slippageBps / 10000);
      const effectiveEntry = direction === 'BUY' ? entryPrice + slippage : entryPrice - slippage;
      const effectiveExit = direction === 'BUY' ? exitPrice - slippage : exitPrice + slippage;

      // Commission
      const commission = positionSize * (this.config.commissionPct / 100) * 2;  // Entry + exit

      // PnL
      const size = positionSize / effectiveEntry;
      const rawPnl = direction === 'BUY'
        ? (effectiveExit - effectiveEntry) * size
        : (effectiveEntry - effectiveExit) * size;
      const pnl = rawPnl - commission;

      // Check actual direction
      const actual = exitPrice > entryPrice ? 1 : 0;

      trades.push({
        entryTime: entryPoint.timestamp,
        exitTime: exitPoint.timestamp,
        entryPrice: effectiveEntry,
        exitPrice: effectiveExit,
        direction,
        prediction: pred,
        actual,
        pnl,
        size,
      });
    }

    return trades;
  }

  private computeResults(
    windows: WindowResult[],
    trades: BacktestTrade[],
    equityCurve: number[],
    modelUsageCount: Record<string, number>
  ): BacktestResults {
    const initial = this.config.initialCapital;
    const final = equityCurve[equityCurve.length - 1] || initial;
    const totalPnl = final - initial;
    const totalReturn = totalPnl / initial;

    // Win rate
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const winRate = trades.length > 0 ? wins.length / trades.length : 0;

    // Profit factor
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Max drawdown
    let peak = initial;
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;
    for (const equity of equityCurve) {
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      const ddPct = dd / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;
      if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
    }

    // Sharpe ratio (simplified, annualized assuming daily)
    const returns = [];
    for (let i = 1; i < equityCurve.length; i++) {
      returns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
    }
    const avgReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
    const stdReturn = returns.length > 0
      ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length)
      : 1;
    const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

    // Consecutive wins/losses
    let consWins = 0, maxConsWins = 0, consLosses = 0, maxConsLosses = 0;
    for (const t of trades) {
      if (t.pnl > 0) {
        consWins++; consLosses = 0;
        maxConsWins = Math.max(maxConsWins, consWins);
      } else {
        consLosses++; consWins = 0;
        maxConsLosses = Math.max(maxConsLosses, consLosses);
      }
    }

    // Average accuracy across windows
    const avgAccuracy = windows.length > 0
      ? windows.reduce((s, w) => s + w.testAccuracy, 0) / windows.length
      : 0;

    const report = this.generateReport({
      totalReturn, totalPnl, sharpeRatio, maxDrawdown, maxDrawdownPct,
      winRate, totalTrades: trades.length, profitFactor,
      avgTradeReturn: trades.length > 0 ? totalPnl / trades.length : 0,
      maxConsecutiveWins: maxConsWins, maxConsecutiveLosses: maxConsLosses,
      avgAccuracy, windows, modelUsageCount,
    });

    return {
      totalReturn,
      totalPnl,
      sharpeRatio,
      maxDrawdown,
      maxDrawdownPct,
      winRate,
      totalTrades: trades.length,
      profitFactor,
      avgTradeReturn: trades.length > 0 ? totalPnl / trades.length : 0,
      maxConsecutiveWins: maxConsWins,
      maxConsecutiveLosses: maxConsLosses,
      avgAccuracy,
      windows,
      trades,
      equityCurve,
      modelUsageCount,
      report,
    };
  }

  private generateReport(metrics: Omit<BacktestResults, 'trades' | 'equityCurve' | 'report'>): string {
    return `
================================================================================
LOB ML STRATEGY BACKTEST REPORT
================================================================================
Rolling Window: ${this.config.trainWindowMs / 60000}min train / ${this.config.testWindowMs / 1000}sec test
Initial Capital: $${this.config.initialCapital.toLocaleString()}
Commission: ${this.config.commissionPct}% | Slippage: ${this.config.slippageBps}bps
Position Size: ${this.config.positionSizePct}% of capital
================================================================================

PERFORMANCE SUMMARY
-------------------
Total Return:        ${(metrics.totalReturn * 100).toFixed(2)}%
Total P&L:           $${metrics.totalPnl.toFixed(2)}
Sharpe Ratio:        ${metrics.sharpeRatio.toFixed(3)}
Max Drawdown:        $${metrics.maxDrawdown.toFixed(2)} (${(metrics.maxDrawdownPct * 100).toFixed(2)}%)
Win Rate:            ${(metrics.winRate * 100).toFixed(1)}%
Profit Factor:       ${metrics.profitFactor === Infinity ? 'Inf' : metrics.profitFactor.toFixed(2)}
Total Trades:        ${metrics.totalTrades}
Avg Trade Return:    $${metrics.avgTradeReturn.toFixed(2)}
Max Consecutive W:   ${metrics.maxConsecutiveWins}
Max Consecutive L:   ${metrics.maxConsecutiveLosses}

ML MODEL PERFORMANCE
--------------------
Avg Test Accuracy:   ${(metrics.avgAccuracy * 100).toFixed(1)}%
Total Windows:       ${metrics.windows.length}

MODEL USAGE:
${Object.entries(metrics.modelUsageCount)
  .sort((a, b) => b[1] - a[1])
  .map(([name, count]) =>
    `  ${name.padEnd(22)} ${count} windows (${((count / metrics.windows.length) * 100).toFixed(0)}%)`
  ).join('\n')}

PER-WINDOW BREAKDOWN (top 10):
${metrics.windows
  .sort((a, b) => b.windowPnl - a.windowPnl)
  .slice(0, 10)
  .map((w, i) =>
    `  ${(i + 1).toString().padStart(2)}. Window ${w.windowIndex}: ${w.modelUsed.padEnd(18)} ` +
    `Acc=${(w.testAccuracy * 100).toFixed(1)}% PnL=$${w.windowPnl.toFixed(2)}`
  ).join('\n')}

================================================================================
`;
  }
}

export default LOBBacktester;
