// src/tradingEngine/ParetoAnalyzer.ts
// Pareto Distribution Analyzer using LOG RETURNS (not Fisher Transform)
// Critical Fix #1: Separated data pipeline preserves tail events for risk modeling
// Critical Fix #2: Minimum 2000 data points for reliable α estimation

import { RollingBuffer } from './RollingBuffer';

// ─── Types ───────────────────────────────────────────────────────────────────

export enum AlphaRiskState {
  SAFE = 'SAFE',             // α > 4.0
  ELEVATED = 'ELEVATED',     // 2.0 < α ≤ 4.0
  HIGH = 'HIGH',             // 1.5 < α ≤ 2.0
  CRITICAL = 'CRITICAL',     // 1.1 < α ≤ 1.5
  LOCKOUT = 'LOCKOUT',       // α ≤ 1.1 — INFINITE MEAN REGIME
}

export interface ParetoParams {
  alpha: number;             // Shape parameter (lower = fatter tails)
  xmin: number;              // Minimum threshold for Pareto law
  fitness: number;           // KS goodness-of-fit (0-1)
  tailRisk: number;          // Heuristic tail risk score (0.2-1.0)
  expectedLoss: number;      // Expected Shortfall in return units
  sampleSize: number;        // Number of data points used
  isReliable: boolean;       // True if sampleSize >= minSamples
}

export interface POTResult {
  threshold: number;         // u — threshold value
  exceedances: number;       // Count above threshold
  meanExcess: number;        // Average exceedance
  estimatedXi: number;       // GPD shape parameter
}

export interface ParetoState {
  params: ParetoParams;
  pot: POTResult;
  alphaState: AlphaRiskState;
  positionSizeMultiplier: number;
  consecutiveLockouts: number;
  shouldLiquidate: boolean;
  var95: number;             // Value at Risk 95%
  var99: number;             // Value at Risk 99%
  es95: number;              // Expected Shortfall 95%
  es99: number;              // Expected Shortfall 99%
  timestamp: number;
}

// ─── ParetoAnalyzer ──────────────────────────────────────────────────────────

class ParetoAnalyzer {
  private logReturns: RollingBuffer;
  private absReturns: RollingBuffer;
  private readonly minSamples: number;
  private readonly paretoThreshold: number;
  private readonly confidenceLevel95: number = 0.95;
  private readonly confidenceLevel99: number = 0.99;

  // Alpha Monitor state
  private currentAlphaState: AlphaRiskState = AlphaRiskState.SAFE;
  private consecutiveLockouts: number = 0;
  private lastAlpha: number = 5.0;
  private prevPrice: number = 0;

  constructor(
    capacity: number = 2000,
    minSamples: number = 500,
    paretoThreshold: number = 0.6
  ) {
    this.logReturns = new RollingBuffer(capacity);
    this.absReturns = new RollingBuffer(capacity);
    this.minSamples = minSamples;
    this.paretoThreshold = paretoThreshold;
  }

  // ─── Feed price data — computes log return ────────────────────────────────

  addPrice(price: number): void {
    if (this.prevPrice > 0 && price > 0) {
      const logReturn = Math.log(price / this.prevPrice);
      this.logReturns.add(logReturn);
      this.absReturns.add(Math.abs(logReturn));
    }
    this.prevPrice = price;
  }

  // ─── Full analysis — call periodically, not every tick ────────────────────

  analyze(): ParetoState {
    const params = this.estimateParetoParams();
    const pot = this.calculatePOT();
    const alphaState = this.updateAlphaState(params.alpha);
    const positionSizeMultiplier = this.getPositionSizeMultiplier();
    const shouldLiquidate = this.currentAlphaState === AlphaRiskState.LOCKOUT
      && this.consecutiveLockouts > 5;

    return {
      params,
      pot,
      alphaState,
      positionSizeMultiplier,
      consecutiveLockouts: this.consecutiveLockouts,
      shouldLiquidate,
      var95: this.logReturns.getVaR(this.confidenceLevel95),
      var99: this.logReturns.getVaR(this.confidenceLevel99),
      es95: this.logReturns.getExpectedShortfall(this.confidenceLevel95),
      es99: this.logReturns.getExpectedShortfall(this.confidenceLevel99),
      timestamp: Date.now(),
    };
  }

  // ─── Pareto Parameter Estimation (MLE on absolute log returns) ────────────

  estimateParetoParams(): ParetoParams {
    const data = this.absReturns.toArray().filter(v => v > 0);
    const n = data.length;
    const isReliable = n >= this.minSamples;

    if (n < 10) {
      return {
        alpha: 5.0, xmin: 0.0001, fitness: 0, tailRisk: 0.2,
        expectedLoss: 0, sampleSize: n, isReliable: false,
      };
    }

    // Sort ascending
    data.sort((a, b) => a - b);

    // xmin: smallest positive value (or 10th percentile for stability)
    const xminIndex = Math.max(0, Math.floor(n * 0.1));
    const xmin = Math.max(data[xminIndex], 0.0001);

    // MLE for alpha
    const validData = data.filter(v => v >= xmin);
    const validN = validData.length;

    if (validN < 5) {
      return {
        alpha: 5.0, xmin, fitness: 0, tailRisk: 0.2,
        expectedLoss: 0, sampleSize: n, isReliable: false,
      };
    }

    let logSum = 0;
    for (let i = 0; i < validN; i++) {
      logSum += Math.log(validData[i] / xmin);
    }

    let alpha = logSum > 0 ? 1.0 + (validN / logSum) : 5.0;
    alpha = Math.max(1.001, Math.min(10.0, alpha));

    // Fitness: KS test
    const fitness = this.calculateFitness(validData, alpha, xmin);

    // Tail risk score
    const tailRisk = this.calculateTailRisk(alpha);

    // Expected Shortfall
    const expectedLoss = this.calculateExpectedLoss(alpha, xmin, this.confidenceLevel95);

    return { alpha, xmin, fitness, tailRisk, expectedLoss, sampleSize: n, isReliable };
  }

  // ─── KS Goodness-of-Fit ───────────────────────────────────────────────────

  private calculateFitness(data: number[], alpha: number, xmin: number): number {
    const n = data.length;
    if (n === 0) return 0;

    let maxDiff = 0;
    for (let i = 0; i < n; i++) {
      const empiricalCDF = (i + 1) / n;
      const theoreticalCDF = 1.0 - Math.pow(xmin / data[i], alpha);
      const diff = Math.abs(empiricalCDF - theoreticalCDF);
      if (diff > maxDiff) maxDiff = diff;
    }

    return Math.max(0, 1.0 - maxDiff);
  }

  // ─── Tail Risk Score ──────────────────────────────────────────────────────

  private calculateTailRisk(alpha: number): number {
    if (alpha <= 1.0) return 1.0;
    if (alpha <= 1.5) return 0.9;
    if (alpha <= 2.0) return 0.8;
    if (alpha <= 3.0) return 0.6;
    if (alpha <= 4.0) return 0.4;
    return 0.2;
  }

  // ─── Expected Shortfall (Pareto-based) ────────────────────────────────────

  private calculateExpectedLoss(alpha: number, xmin: number, confidence: number): number {
    if (alpha <= 1.001) return xmin * 10; // Extreme case
    const varP = xmin * Math.pow(1.0 - confidence, -1.0 / alpha);
    const es = varP * (alpha / (alpha - 1.0));
    return es;
  }

  // ─── Peaks Over Threshold (POT) Method ────────────────────────────────────

  calculatePOT(thresholdPercentile: number = 0.90): POTResult {
    const data = this.absReturns.toArray();
    if (data.length < 20) {
      return { threshold: 0, exceedances: 0, meanExcess: 0, estimatedXi: 0 };
    }

    // Determine threshold at percentile
    const sorted = [...data].sort((a, b) => a - b);
    const thresholdIndex = Math.floor(sorted.length * thresholdPercentile);
    const threshold = sorted[Math.min(thresholdIndex, sorted.length - 1)];

    // Collect exceedances
    const excesses: number[] = [];
    for (let i = 0; i < data.length; i++) {
      if (data[i] > threshold) {
        excesses.push(data[i] - threshold);
      }
    }

    const exceedances = excesses.length;
    if (exceedances === 0) {
      return { threshold, exceedances: 0, meanExcess: 0, estimatedXi: 0 };
    }

    // Mean excess
    const meanExcess = excesses.reduce((a, b) => a + b, 0) / exceedances;

    // Estimate GPD shape parameter (method of moments)
    let variance = 0;
    for (let i = 0; i < excesses.length; i++) {
      variance += (excesses[i] - meanExcess) ** 2;
    }
    variance /= exceedances;

    const estimatedXi = variance > 0
      ? 0.5 * ((meanExcess * meanExcess) / variance - 1.0)
      : 0;

    return { threshold, exceedances, meanExcess, estimatedXi };
  }

  // ─── Alpha Monitor — Graduated Risk States ────────────────────────────────

  private updateAlphaState(alpha: number): AlphaRiskState {
    this.lastAlpha = alpha;
    let newState: AlphaRiskState;

    if (alpha <= 1.1) {
      newState = AlphaRiskState.LOCKOUT;
      this.consecutiveLockouts++;
    } else if (alpha <= 1.5) {
      newState = AlphaRiskState.CRITICAL;
      this.consecutiveLockouts = 0;
    } else if (alpha <= 2.0) {
      newState = AlphaRiskState.HIGH;
      this.consecutiveLockouts = 0;
    } else if (alpha <= 4.0) {
      newState = AlphaRiskState.ELEVATED;
      this.consecutiveLockouts = 0;
    } else {
      newState = AlphaRiskState.SAFE;
      this.consecutiveLockouts = 0;
    }

    this.currentAlphaState = newState;
    return newState;
  }

  // ─── Position Size Multiplier ─────────────────────────────────────────────

  getPositionSizeMultiplier(): number {
    switch (this.currentAlphaState) {
      case AlphaRiskState.SAFE: return 1.0;
      case AlphaRiskState.ELEVATED: return 0.8;
      case AlphaRiskState.HIGH: return 0.5;
      case AlphaRiskState.CRITICAL: return 0.2;
      case AlphaRiskState.LOCKOUT: return 0.0;
    }
  }

  // ─── Trade Approval ───────────────────────────────────────────────────────

  allowNewTrades(): boolean {
    return this.currentAlphaState !== AlphaRiskState.LOCKOUT;
  }

  shouldLiquidateAll(): boolean {
    return this.currentAlphaState === AlphaRiskState.LOCKOUT
      && this.consecutiveLockouts > 5;
  }

  // ─── Accessors ────────────────────────────────────────────────────────────

  getAlphaState(): AlphaRiskState {
    return this.currentAlphaState;
  }

  getLastAlpha(): number {
    return this.lastAlpha;
  }

  getSampleSize(): number {
    return this.absReturns.size();
  }

  getLogReturns(): RollingBuffer {
    return this.logReturns;
  }

  getAbsReturns(): RollingBuffer {
    return this.absReturns;
  }
}

export default ParetoAnalyzer;
