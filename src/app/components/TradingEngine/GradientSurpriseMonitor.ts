// src/tradingEngine/GradientSurpriseMonitor.ts
// MCML Integration: Gradient Norm as Trade Gate
// Detects when the ML model is "surprised" (confused) by tracking:
// 1. Signal direction oscillation (rapid buy/sell flipping)
// 2. Confidence volatility (confidence swinging wildly)
// 3. Loss rate of change (loss spiking = model doesn't fit current data)
// When surprise is high → block trades (market is doing something statistically improbable)

import { RollingBuffer } from './RollingBuffer';

export interface SurpriseState {
  gradientNorm: number;          // Composite surprise score (0 = calm, 1+ = confused)
  directionFlipRate: number;     // How often signal flips direction (0-1)
  confidenceVolatility: number;  // StdDev of recent confidence values
  lossRateOfChange: number;      // How fast loss is changing (normalized)
  isUnstable: boolean;           // True when gradientNorm > threshold
  shouldBlockTrade: boolean;     // True when surprise is dangerously high
  blockReason: string | null;    // Human-readable reason for blocking
  timestamp: number;
}

class GradientSurpriseMonitor {
  private directionHistory: RollingBuffer;
  private confidenceHistory: RollingBuffer;
  private lossHistory: RollingBuffer;
  private flipHistory: RollingBuffer;

  private readonly surpriseThreshold: number;
  private readonly blockThreshold: number;
  private readonly windowSize: number;

  private lastDirection: number = 0;
  private lastSurpriseState: SurpriseState;

  constructor(
    windowSize: number = 50,
    surpriseThreshold: number = 0.6,
    blockThreshold: number = 0.85
  ) {
    this.windowSize = windowSize;
    this.surpriseThreshold = surpriseThreshold;
    this.blockThreshold = blockThreshold;

    this.directionHistory = new RollingBuffer(windowSize);
    this.confidenceHistory = new RollingBuffer(windowSize);
    this.lossHistory = new RollingBuffer(windowSize);
    this.flipHistory = new RollingBuffer(windowSize);

    this.lastSurpriseState = {
      gradientNorm: 0,
      directionFlipRate: 0,
      confidenceVolatility: 0,
      lossRateOfChange: 0,
      isUnstable: false,
      shouldBlockTrade: false,
      blockReason: null,
      timestamp: Date.now(),
    };
  }

  // ─── Feed signal data every tick ────────────────────────────────────────────

  addSignal(direction: number, confidence: number): void {
    this.directionHistory.add(direction);
    this.confidenceHistory.add(confidence);

    // Track direction flips (1 = flip, 0 = same)
    const quantDir = direction > 0 ? 1 : direction < 0 ? -1 : 0;
    if (this.lastDirection !== 0 && quantDir !== 0 && quantDir !== this.lastDirection) {
      this.flipHistory.add(1);
    } else {
      this.flipHistory.add(0);
    }
    if (quantDir !== 0) {
      this.lastDirection = quantDir;
    }
  }

  addLoss(loss: number): void {
    this.lossHistory.add(loss);
  }

  // ─── Compute surprise (call periodically, not every tick) ───────────────────

  computeSurprise(): SurpriseState {
    const flipRate = this.computeFlipRate();
    const confVol = this.computeConfidenceVolatility();
    const lossRoC = this.computeLossRateOfChange();

    // Composite gradient norm: weighted combination of all surprise signals
    // Flip rate is the strongest signal (model oscillating = very confused)
    const gradientNorm = (
      flipRate * 0.45 +
      confVol * 0.30 +
      lossRoC * 0.25
    );

    const isUnstable = gradientNorm > this.surpriseThreshold;
    const shouldBlock = gradientNorm > this.blockThreshold;

    let blockReason: string | null = null;
    if (shouldBlock) {
      if (flipRate > 0.5) blockReason = 'Signal oscillation (direction flipping rapidly)';
      else if (confVol > 0.3) blockReason = 'Confidence instability (model uncertain)';
      else if (lossRoC > 0.5) blockReason = 'Loss spike (market surprise)';
      else blockReason = 'Combined gradient surprise exceeds threshold';
    }

    this.lastSurpriseState = {
      gradientNorm,
      directionFlipRate: flipRate,
      confidenceVolatility: confVol,
      lossRateOfChange: lossRoC,
      isUnstable,
      shouldBlockTrade: shouldBlock,
      blockReason,
      timestamp: Date.now(),
    };

    return this.lastSurpriseState;
  }

  // ─── Direction flip rate: how often signal direction changes ─────────────────

  private computeFlipRate(): number {
    if (this.flipHistory.size() < 5) return 0;
    // Mean of flip flags = proportion of ticks that are flips
    const rate = this.flipHistory.mean();
    // Normalize: >0.3 flip rate is extreme (>30% of ticks are direction changes)
    return Math.min(1.0, rate / 0.3);
  }

  // ─── Confidence volatility: stddev of recent confidence values ──────────────

  private computeConfidenceVolatility(): number {
    if (this.confidenceHistory.size() < 5) return 0;
    const stdDev = this.confidenceHistory.stdDev();
    // Normalize: stddev > 0.2 is extreme instability
    return Math.min(1.0, stdDev / 0.2);
  }

  // ─── Loss rate of change: how fast the loss is spiking ──────────────────────

  private computeLossRateOfChange(): number {
    if (this.lossHistory.size() < 5) return 0;
    const data = this.lossHistory.toArray();
    const n = data.length;

    // Compare recent loss to earlier loss (EMA approach)
    const recentWindow = Math.min(5, Math.floor(n / 2));
    let recentSum = 0;
    let olderSum = 0;
    for (let i = n - recentWindow; i < n; i++) recentSum += data[i];
    for (let i = 0; i < recentWindow; i++) olderSum += data[i];

    const recentAvg = recentSum / recentWindow;
    const olderAvg = olderSum / recentWindow;

    if (olderAvg === 0) return 0;
    const roc = (recentAvg - olderAvg) / olderAvg;
    // Normalize: >50% increase is extreme
    return Math.min(1.0, Math.max(0, roc / 0.5));
  }

  // ─── Accessors ──────────────────────────────────────────────────────────────

  getState(): SurpriseState {
    return this.lastSurpriseState;
  }

  getSampleCount(): number {
    return this.directionHistory.size();
  }
}

export default GradientSurpriseMonitor;
