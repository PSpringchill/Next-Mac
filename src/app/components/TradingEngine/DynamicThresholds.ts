// src/tradingEngine/DynamicThresholds.ts
// Critical Fix #3: Percentile-based asset-agnostic regime detection
// Replaces hardcoded thresholds that break across different symbols

import { RollingBuffer } from './RollingBuffer';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ThresholdSet {
  volatilityHigh: number;    // 90th percentile of ATR ratio
  volatilityLow: number;     // 10th percentile of ATR ratio
  momentumHigh: number;      // 90th percentile of |momentum|
  momentumLow: number;       // 10th percentile of |momentum|
  sampleSize: number;
  calculatedAt: number;
  isCalibrated: boolean;     // True when enough samples collected
}

export interface RegimeResult {
  regime: 'TRENDING' | 'RANGING' | 'VOLATILE' | 'CALM';
  strength: number;          // 0-1 normalized
  reversalRisk: boolean;
  volatilityRatio: number;
  momentum: number;
  thresholds: ThresholdSet;
}

// ─── DynamicThresholds ───────────────────────────────────────────────────────

class DynamicThresholds {
  private atrRatioHistory: RollingBuffer;
  private momentumHistory: RollingBuffer;
  private readonly minCalibrationSamples: number;
  private readonly recalibrationIntervalMs: number;
  private cachedThresholds: ThresholdSet | null = null;
  private lastCalibrationTime: number = 0;

  // Price tracking for momentum
  private priceHistory: number[] = [];
  private readonly momentumPeriod: number;

  // ATR tracking
  private atrHistory: RollingBuffer;
  private readonly atrPeriod: number;

  constructor(
    historySize: number = 1000,
    minCalibrationSamples: number = 100,
    recalibrationIntervalMs: number = 5 * 60 * 1000,  // 5 minutes
    atrPeriod: number = 14,
    momentumPeriod: number = 20
  ) {
    this.atrRatioHistory = new RollingBuffer(historySize);
    this.momentumHistory = new RollingBuffer(historySize);
    this.atrHistory = new RollingBuffer(historySize);
    this.minCalibrationSamples = minCalibrationSamples;
    this.recalibrationIntervalMs = recalibrationIntervalMs;
    this.atrPeriod = atrPeriod;
    this.momentumPeriod = momentumPeriod;
  }

  // ─── Feed data ────────────────────────────────────────────────────────────

  addATR(atr: number): void {
    this.atrHistory.add(atr);

    // Calculate ATR ratio (current / SMA of ATR)
    const atrMean = this.atrHistory.mean();
    if (atrMean > 0) {
      const atrRatio = atr / atrMean;
      this.atrRatioHistory.add(atrRatio);
    }
  }

  addPrice(price: number): void {
    this.priceHistory.push(price);
    if (this.priceHistory.length > this.momentumPeriod + 1) {
      this.priceHistory.shift();
    }

    // Calculate momentum (ROC over momentumPeriod)
    if (this.priceHistory.length >= 2) {
      const pastPrice = this.priceHistory[0];
      if (pastPrice > 0) {
        const momentum = (price - pastPrice) / pastPrice;
        this.momentumHistory.add(momentum);
      }
    }
  }

  // ─── Get current thresholds (lazy recalibration) ──────────────────────────

  getThresholds(): ThresholdSet {
    const now = Date.now();
    const needsRecalibration = !this.cachedThresholds
      || (now - this.lastCalibrationTime > this.recalibrationIntervalMs);

    if (needsRecalibration) {
      this.cachedThresholds = this.calibrate();
      this.lastCalibrationTime = now;
    }

    return this.cachedThresholds!;
  }

  // ─── Calibrate thresholds from history ────────────────────────────────────

  private calibrate(): ThresholdSet {
    const atrSize = this.atrRatioHistory.size();
    const momSize = this.momentumHistory.size();
    const isCalibrated = atrSize >= this.minCalibrationSamples
      && momSize >= this.minCalibrationSamples;

    if (atrSize < 10) {
      // Not enough data — use sensible defaults
      return {
        volatilityHigh: 1.5,
        volatilityLow: 0.7,
        momentumHigh: 0.005,
        momentumLow: 0.001,
        sampleSize: atrSize,
        calculatedAt: Date.now(),
        isCalibrated: false,
      };
    }

    // Use absolute momentum for threshold calculation
    const absMomentum = this.momentumHistory.toArray().map(Math.abs);
    const absMomBuffer = new RollingBuffer(absMomentum.length);
    for (const v of absMomentum) absMomBuffer.add(v);

    return {
      volatilityHigh: this.atrRatioHistory.getPercentile(0.90),
      volatilityLow: this.atrRatioHistory.getPercentile(0.10),
      momentumHigh: absMomBuffer.getPercentile(0.90),
      momentumLow: absMomBuffer.getPercentile(0.10),
      sampleSize: atrSize,
      calculatedAt: Date.now(),
      isCalibrated,
    };
  }

  // ─── Detect regime using dynamic thresholds ───────────────────────────────

  detectRegime(
    currentATR: number,
    currentPrice: number,
    rsi?: number
  ): RegimeResult {
    const thresholds = this.getThresholds();

    // Current ATR ratio
    const atrMean = this.atrHistory.mean();
    const volatilityRatio = atrMean > 0 ? currentATR / atrMean : 1.0;

    // Current momentum
    const momentum = this.priceHistory.length >= 2
      ? (currentPrice - this.priceHistory[0]) / this.priceHistory[0]
      : 0;

    let regime: RegimeResult['regime'] = 'RANGING';
    let strength = 0;
    let reversalRisk = false;

    // Classify using DYNAMIC thresholds (not hardcoded)
    if (volatilityRatio > thresholds.volatilityHigh) {
      regime = 'VOLATILE';
      strength = Math.min(1, (volatilityRatio - thresholds.volatilityHigh)
        / (thresholds.volatilityHigh * 0.5));
      reversalRisk = true;
    } else if (volatilityRatio < thresholds.volatilityLow) {
      regime = 'CALM';
      strength = Math.min(1, (thresholds.volatilityLow - volatilityRatio)
        / (thresholds.volatilityLow * 0.5));
    } else if (Math.abs(momentum) > thresholds.momentumHigh) {
      regime = 'TRENDING';
      strength = Math.min(1, Math.abs(momentum) / (thresholds.momentumHigh * 2));

      // Check RSI for reversal risk
      if (rsi !== undefined) {
        if (rsi > 75 || rsi < 25) {
          reversalRisk = true;
        }
      }
    } else {
      regime = 'RANGING';
      strength = 1.0 - (Math.abs(momentum) / thresholds.momentumHigh);
    }

    return {
      regime,
      strength: Math.max(0, Math.min(1, strength)),
      reversalRisk,
      volatilityRatio,
      momentum,
      thresholds,
    };
  }

  // ─── Accessors ────────────────────────────────────────────────────────────

  isCalibrated(): boolean {
    return this.getThresholds().isCalibrated;
  }

  getSampleSize(): number {
    return this.atrRatioHistory.size();
  }
}

export default DynamicThresholds;
