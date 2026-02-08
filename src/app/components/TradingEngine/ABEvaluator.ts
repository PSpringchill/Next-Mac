import { MarketData, BacktestResult } from '@tradingEngine/types';
import GridSearchOptimizer, { GridSearchResult, GridParams } from './GridSearchOptimizer';

export interface ABResult {
  // Grid search results (replaces old baseline/MDP approach)
  gridSearch: GridSearchResult;
  bestParams: GridParams & { score: number };
  bestMetrics: BacktestResult;
  // Summary deltas (best vs median for quick display)
  delta: {
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
  };
  // Top 5 parameter sets for comparison
  top5: Array<{ params: GridParams; metrics: BacktestResult; score: number }>;
}

class ABEvaluator {
  private optimizer: GridSearchOptimizer;

  constructor() {
    this.optimizer = new GridSearchOptimizer();
  }

  run(data: MarketData[]): ABResult {
    const gridSearch = this.optimizer.run(data);

    // Compute median metrics for delta comparison
    const validResults = gridSearch.all.filter(r => r.score > -Infinity);
    const medianIdx = Math.floor(validResults.length / 2);
    const sorted = [...validResults].sort((a, b) => a.metrics.totalReturn - b.metrics.totalReturn);
    const median = sorted[medianIdx]?.metrics ?? { totalReturn: 0, sharpeRatio: 0, maxDrawdown: 0, winRate: 0 };

    return {
      gridSearch,
      bestParams: gridSearch.best,
      bestMetrics: gridSearch.bestMetrics,
      delta: {
        totalReturn: gridSearch.bestMetrics.totalReturn - median.totalReturn,
        sharpeRatio: gridSearch.bestMetrics.sharpeRatio - median.sharpeRatio,
        maxDrawdown: gridSearch.bestMetrics.maxDrawdown - median.maxDrawdown,
        winRate: gridSearch.bestMetrics.winRate - median.winRate,
      },
      top5: gridSearch.all.slice(0, 5),
    };
  }
}

export default ABEvaluator;
export type { GridSearchResult, GridParams };
