import { MarketData, BacktestResult } from '@tradingEngine/types';
import GridSearchOptimizer, { GridSearchResult, GridParams, DirectionalStats, ValidationResult } from './GridSearchOptimizer';

export interface ABResult {
  gridSearch: GridSearchResult;
  bestParams: GridParams & { score: number };
  bestMetrics: BacktestResult;
  bestDirectional: DirectionalStats;
  bestValidation: ValidationResult | null;
  delta: {
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
  };
  top5: Array<{ params: GridParams; metrics: BacktestResult; directional: DirectionalStats; score: number; validation?: ValidationResult }>;
}

class ABEvaluator {
  private optimizer: GridSearchOptimizer;

  constructor() {
    this.optimizer = new GridSearchOptimizer();
  }

  run(data: MarketData[]): ABResult {
    const gridSearch = this.optimizer.run(data);

    // Find the best validated result for directional stats
    const bestCell = gridSearch.all.find(
      r => r.params.tpPct === gridSearch.best.tpPct
        && r.params.slPct === gridSearch.best.slPct
        && r.params.entryObi === gridSearch.best.entryObi
    );
    const defaultDir = { buyTrades: 0, buyWins: 0, buyWinRate: 0, sellTrades: 0, sellWins: 0, sellWinRate: 0 };

    // Compute median metrics for delta comparison
    const validResults = gridSearch.all.filter(r => r.score > -Infinity);
    const sorted = [...validResults].sort((a, b) => a.metrics.totalReturn - b.metrics.totalReturn);
    const medianIdx = Math.floor(sorted.length / 2);
    const median = sorted[medianIdx]?.metrics ?? { totalReturn: 0, sharpeRatio: 0, maxDrawdown: 0, winRate: 0 };

    return {
      gridSearch,
      bestParams: gridSearch.best,
      bestMetrics: gridSearch.bestMetrics,
      bestDirectional: bestCell?.directional ?? defaultDir,
      bestValidation: bestCell?.validation ?? null,
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
export type { GridSearchResult, GridParams, ValidationResult };
