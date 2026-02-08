// ─── Radar Vector ─────────────────────────────────────────────────────────────
// Background Grid Search monitor that collects live market data and runs
// GridSearchOptimizer when all ensemble technical conditions are met.
//
// Trigger: search fires when allConditionsMet === true AND enough data AND
//          at least `cooldownTicks` have elapsed since the last search.
//
// Status transitions:
//   SCANNING  → collecting data, not enough for grid search yet
//   SEARCHING → running grid search on collected data
//   ESTABLISH → found parameters with Sharpe > 1.0 AND WinRate > 50%
//   NO VECTOR → grid search completed but no viable parameters found
//
// When ESTABLISH, provides: Drawdown %, Entry OBI %, TP %, SL %

import type { MarketData } from '@tradingEngine/types';
import GridSearchOptimizer, {
  type GridSearchResult,
  type GridParams,
} from './GridSearchOptimizer';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface RadarVectorConfig {
  bufferSize: number;          // Max market data ticks to retain (default 500)
  minDataPoints: number;       // Minimum ticks before first grid search (default 100)
  cooldownTicks: number;       // Min ticks between searches (prevents rapid re-fires)
  sharpeThreshold: number;     // Minimum Sharpe to ESTABLISH (default 1.0)
  winRateThreshold: number;    // Minimum WinRate to ESTABLISH (default 0.50)
}

const DEFAULT_CONFIG: RadarVectorConfig = {
  bufferSize: 500,
  minDataPoints: 100,
  cooldownTicks: 50,
  sharpeThreshold: 1.0,
  winRateThreshold: 0.50,
};

// ─── State ───────────────────────────────────────────────────────────────────

export type RadarVectorStatus = 'SCANNING' | 'SEARCHING' | 'ESTABLISH' | 'NO VECTOR';

export interface RadarVectorState {
  status: RadarVectorStatus;
  // Optimal parameters (only valid when ESTABLISH)
  tpPct: number;               // Take-profit %
  slPct: number;               // Stop-loss %
  entryObi: number;            // Entry OBI threshold %
  drawdownPct: number;         // Max drawdown from backtest %
  // Metrics from the best grid search result
  sharpe: number;
  winRate: number;
  totalReturn: number;
  // Search metadata
  dataPoints: number;          // Current buffer size
  totalCombinations: number;   // Last search combinations tested
  searchCount: number;         // How many searches have been run
  lastSearchMs: number;        // Last search duration (ms)
  validatedCount: number;      // Passed anti-overfitting
  rejectedCount: number;       // Failed anti-overfitting
  timestamp: number;           // Last update timestamp
}

const EMPTY_STATE: RadarVectorState = {
  status: 'SCANNING',
  tpPct: 0,
  slPct: 0,
  entryObi: 0,
  drawdownPct: 0,
  sharpe: 0,
  winRate: 0,
  totalReturn: 0,
  dataPoints: 0,
  totalCombinations: 0,
  searchCount: 0,
  lastSearchMs: 0,
  validatedCount: 0,
  rejectedCount: 0,
  timestamp: 0,
};

// ─── Radar Vector Class ──────────────────────────────────────────────────────

class RadarVector {
  private config: RadarVectorConfig;
  private optimizer: GridSearchOptimizer;
  private dataBuffer: MarketData[] = [];
  private ticksSinceLastSearch: number = 0;
  private state: RadarVectorState = { ...EMPTY_STATE };
  private isSearching: boolean = false;

  constructor(config?: Partial<RadarVectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.optimizer = new GridSearchOptimizer();
  }

  // ─── Feed market data tick ─────────────────────────────────────────────

  feed(marketData: MarketData, allConditionsMet: boolean = false): RadarVectorState {
    // Add to rolling buffer
    this.dataBuffer.push(marketData);
    if (this.dataBuffer.length > this.config.bufferSize) {
      this.dataBuffer.shift();
    }

    this.ticksSinceLastSearch++;
    this.state.dataPoints = this.dataBuffer.length;
    this.state.timestamp = Date.now();

    // Trigger search when: all ensemble technical conditions met,
    // enough data collected, and cooldown elapsed since last search
    if (
      allConditionsMet
      && !this.isSearching
      && this.dataBuffer.length >= this.config.minDataPoints
      && this.ticksSinceLastSearch >= this.config.cooldownTicks
    ) {
      this.runSearch();
    }

    // Still collecting data
    if (this.dataBuffer.length < this.config.minDataPoints && this.state.searchCount === 0) {
      this.state.status = 'SCANNING';
    }

    return this.getState();
  }

  // ─── Run Grid Search ───────────────────────────────────────────────────

  private runSearch(): void {
    this.isSearching = true;
    this.ticksSinceLastSearch = 0;

    try {
      const result: GridSearchResult = this.optimizer.run([...this.dataBuffer]);
      this.state.searchCount++;
      this.state.lastSearchMs = result.elapsed;
      this.state.totalCombinations = result.totalCombinations;
      this.state.validatedCount = result.validatedCount;
      this.state.rejectedCount = result.rejectedCount;

      // Extract best result metrics
      const best = result.best;
      const metrics = result.bestMetrics;

      this.state.tpPct = best.tpPct;
      this.state.slPct = best.slPct;
      this.state.entryObi = best.entryObi;
      this.state.drawdownPct = metrics.maxDrawdown * 100;
      this.state.sharpe = metrics.sharpeRatio;
      this.state.winRate = metrics.winRate;
      this.state.totalReturn = metrics.totalReturn;

      // Determine ESTABLISH status
      if (
        metrics.sharpeRatio >= this.config.sharpeThreshold
        && metrics.winRate >= this.config.winRateThreshold
      ) {
        this.state.status = 'ESTABLISH';
      } else {
        this.state.status = 'NO VECTOR';
      }
    } catch {
      // Search failed — remain in current state
      this.state.status = this.state.searchCount > 0 ? 'NO VECTOR' : 'SCANNING';
    } finally {
      this.isSearching = false;
    }
  }

  // ─── Force an immediate search (e.g. from UI button) ──────────────────

  forceSearch(): RadarVectorState {
    if (this.dataBuffer.length >= 20) {
      this.runSearch();
    }
    return this.getState();
  }

  // ─── Getters ───────────────────────────────────────────────────────────

  getState(): RadarVectorState {
    return { ...this.state };
  }

  getEstablishedParams(): GridParams | null {
    if (this.state.status !== 'ESTABLISH') return null;
    return {
      tpPct: this.state.tpPct,
      slPct: this.state.slPct,
      entryObi: this.state.entryObi,
    };
  }

  isEstablished(): boolean {
    return this.state.status === 'ESTABLISH';
  }

  getConfig(): RadarVectorConfig {
    return { ...this.config };
  }

  reset(): void {
    this.dataBuffer = [];
    this.ticksSinceLastSearch = 0;
    this.state = { ...EMPTY_STATE };
    this.isSearching = false;
  }
}

export default RadarVector;
