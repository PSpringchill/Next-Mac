// ─── Indicator Profiler ─────────────────────────────────────────────────────
// Analyzes which indicator value ranges most frequently appear during
// profitable trades. Builds a probability distribution per indicator bin,
// identifies optimal configurations, and scores live market alignment.
//
// Flow:
//   1. Bootstrap: calibrate from 1000×1m historical candles (RLSnapshot buffer)
//   2. Live ticks: continuously refine distributions with each new tick
//
// Each of the 28 RL features is binned into N quantile-based bins.
// For each bin we track profit/loss counts from forward returns.
// The "optimal config" = the bin per indicator with highest profit probability.
// "Match score" = fraction of indicators currently in their optimal bin.

import type { RLSnapshot } from './RLDataCollector';
import { RL_FEATURE_NAMES, RL_FEATURE_DIM } from './RLDataCollector';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IndicatorBin {
  min: number;
  max: number;
  profitCount: number;
  lossCount: number;
  totalCount: number;
  profitProb: number;       // profitCount / totalCount
  avgReturn: number;        // average forward return in this bin
  returnSum: number;        // running sum for avg computation
}

export interface IndicatorProfile {
  featureIndex: number;
  featureName: string;
  bins: IndicatorBin[];
  optimalBinIdx: number;        // bin with highest profit probability
  optimalRange: [number, number]; // [min, max] of optimal bin
  optimalProfitProb: number;    // profit probability in optimal bin
  worstBinIdx: number;          // bin with lowest profit probability
  worstProfitProb: number;
  currentValue: number;         // latest feature value
  currentBinIdx: number;        // which bin current value falls into
  isInOptimal: boolean;         // current value in optimal bin?
  alignment: number;            // 0-1 how close to optimal center
  discriminativePower: number;  // how much optimal differs from average (predictiveness)
}

export interface IndicatorProfilerState {
  profiles: IndicatorProfile[];
  totalSamples: number;
  profitableSamples: number;
  overallProfitRate: number;    // profitableSamples / totalSamples
  matchScore: number;           // 0-1: fraction of indicators in optimal zone
  weightedMatchScore: number;   // weighted by discriminative power
  topIndicators: { name: string; profitProb: number; power: number }[];
  bottomIndicators: { name: string; profitProb: number; power: number }[];
  calibrationSource: 'none' | 'bootstrap' | 'live' | 'both';
  lastUpdate: number;
}

export interface IndicatorProfilerConfig {
  numBins: number;              // bins per indicator (default: 10)
  lookAheadTicks: number;       // ticks to look ahead for return (default: 30)
  profitThreshold: number;      // min return % to count as profitable (default: 0.01)
  minSamplesPerBin: number;     // min samples for a bin to be considered (default: 5)
  topN: number;                 // top N indicators to report (default: 8)
  decayFactor: number;          // exponential decay for older samples (default: 0.999)
}

const DEFAULT_CONFIG: IndicatorProfilerConfig = {
  numBins: 10,
  lookAheadTicks: 30,
  profitThreshold: 0.01,        // 0.01% forward return = profitable
  minSamplesPerBin: 5,
  topN: 8,
  decayFactor: 0.999,
};

// ─── Indicator Profiler Class ───────────────────────────────────────────────

class IndicatorProfiler {
  private config: IndicatorProfilerConfig;

  // Per-feature bin edges (computed from data distribution)
  private binEdges: number[][] = [];       // [featureIdx][edgeIdx] — numBins+1 edges per feature
  private bins: IndicatorBin[][] = [];     // [featureIdx][binIdx]
  private totalSamples: number = 0;
  private profitableSamples: number = 0;
  private calibrated: boolean = false;
  private calibrationSource: 'none' | 'bootstrap' | 'live' | 'both' = 'none';
  private currentFeatures: number[] = new Array(RL_FEATURE_DIM).fill(0);

  constructor(config?: Partial<IndicatorProfilerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initBins();
  }

  // ─── Initialize empty bins with uniform edges ───────────────────────────

  private initBins(): void {
    this.binEdges = [];
    this.bins = [];

    for (let f = 0; f < RL_FEATURE_DIM; f++) {
      // Default uniform edges [-2, 2] until calibrated from data
      const edges: number[] = [];
      for (let e = 0; e <= this.config.numBins; e++) {
        edges.push(-2 + (4 / this.config.numBins) * e);
      }
      this.binEdges.push(edges);

      const featureBins: IndicatorBin[] = [];
      for (let b = 0; b < this.config.numBins; b++) {
        featureBins.push({
          min: edges[b],
          max: edges[b + 1],
          profitCount: 0,
          lossCount: 0,
          totalCount: 0,
          profitProb: 0,
          avgReturn: 0,
          returnSum: 0,
        });
      }
      this.bins.push(featureBins);
    }
  }

  // ─── Calibrate bin edges from actual data distribution (quantile-based) ─

  private calibrateBinEdges(buffer: readonly RLSnapshot[]): void {
    for (let f = 0; f < RL_FEATURE_DIM; f++) {
      // Collect all values for this feature
      const values = buffer.map(s => s.features[f]).filter(v => Number.isFinite(v)).sort((a, b) => a - b);
      const n = values.length;
      if (n < this.config.numBins * 2) continue; // not enough data

      // Quantile-based edges for uniform bin population
      const edges: number[] = [];
      for (let e = 0; e <= this.config.numBins; e++) {
        const pct = e / this.config.numBins;
        const idx = Math.min(Math.floor(pct * n), n - 1);
        edges.push(values[idx]);
      }

      // Ensure first edge is -Infinity and last is +Infinity for coverage
      edges[0] = -Infinity;
      edges[edges.length - 1] = Infinity;

      // Ensure strictly increasing (handle duplicates)
      for (let i = 1; i < edges.length - 1; i++) {
        if (edges[i] <= edges[i - 1]) {
          edges[i] = edges[i - 1] + 1e-10;
        }
      }

      this.binEdges[f] = edges;

      // Update bin ranges
      for (let b = 0; b < this.config.numBins; b++) {
        this.bins[f][b].min = edges[b];
        this.bins[f][b].max = edges[b + 1];
      }
    }
  }

  // ─── Find which bin a value falls into ──────────────────────────────────

  private findBin(featureIdx: number, value: number): number {
    const edges = this.binEdges[featureIdx];
    for (let b = 0; b < this.config.numBins; b++) {
      if (value >= edges[b] && value < edges[b + 1]) {
        return b;
      }
    }
    // Fallback: last bin for values >= last edge
    return this.config.numBins - 1;
  }

  // ─── Process a single (snapshot, futureReturn) pair ─────────────────────

  private processSample(features: number[], forwardReturn: number): void {
    const isProfitable = forwardReturn > this.config.profitThreshold;

    this.totalSamples++;
    if (isProfitable) this.profitableSamples++;

    for (let f = 0; f < RL_FEATURE_DIM; f++) {
      const val = features[f];
      if (!Number.isFinite(val)) continue;

      const binIdx = this.findBin(f, val);
      const bin = this.bins[f][binIdx];

      bin.totalCount++;
      if (isProfitable) {
        bin.profitCount++;
      } else {
        bin.lossCount++;
      }
      bin.returnSum += forwardReturn;
      bin.avgReturn = bin.returnSum / bin.totalCount;
      bin.profitProb = bin.totalCount > 0 ? bin.profitCount / bin.totalCount : 0;
    }
  }

  // ─── Apply exponential decay to all bins (keeps recent data more relevant) ─

  private applyDecay(): void {
    const d = this.config.decayFactor;
    for (let f = 0; f < RL_FEATURE_DIM; f++) {
      for (let b = 0; b < this.config.numBins; b++) {
        const bin = this.bins[f][b];
        bin.profitCount *= d;
        bin.lossCount *= d;
        bin.totalCount *= d;
        bin.returnSum *= d;
        // Recompute derived
        bin.profitProb = bin.totalCount > 0.5 ? bin.profitCount / bin.totalCount : 0;
        bin.avgReturn = bin.totalCount > 0.5 ? bin.returnSum / bin.totalCount : 0;
      }
    }
    this.totalSamples *= d;
    this.profitableSamples *= d;
  }

  // ─── Calibrate from historical buffer (bootstrap) ───────────────────────
  // Call once with the full RLSnapshot buffer after bootstrap replay.

  calibrateFromBuffer(buffer: readonly RLSnapshot[]): void {
    const { lookAheadTicks } = this.config;
    const n = buffer.length;
    if (n < lookAheadTicks + 10) return;

    // Step 1: Compute quantile-based bin edges from data distribution
    this.calibrateBinEdges(buffer);

    // Step 2: Reset counts
    for (let f = 0; f < RL_FEATURE_DIM; f++) {
      for (let b = 0; b < this.config.numBins; b++) {
        const bin = this.bins[f][b];
        bin.profitCount = 0;
        bin.lossCount = 0;
        bin.totalCount = 0;
        bin.profitProb = 0;
        bin.avgReturn = 0;
        bin.returnSum = 0;
      }
    }
    this.totalSamples = 0;
    this.profitableSamples = 0;

    // Step 3: Process all valid snapshot pairs
    const maxIdx = n - lookAheadTicks;
    for (let i = 0; i < maxIdx; i++) {
      const snap = buffer[i];
      const future = buffer[Math.min(i + lookAheadTicks, n - 1)];
      const forwardReturn = (future.raw.price - snap.raw.price) / snap.raw.price * 100;
      this.processSample(snap.features, forwardReturn);
    }

    this.calibrated = true;
    this.calibrationSource = 'bootstrap';
    console.log(`[IndicatorProfiler] Calibrated from ${maxIdx} samples, ${this.profitableSamples.toFixed(0)} profitable`);
  }

  // ─── Feed a live tick pair for incremental refinement ───────────────────
  // Call with the current snapshot and the snapshot from `lookAheadTicks` ago.

  feedLiveTick(currentSnapshot: RLSnapshot, pastSnapshot: RLSnapshot | null): void {
    this.currentFeatures = [...currentSnapshot.features];

    // If we have a past snapshot, we can now evaluate its forward return
    if (pastSnapshot) {
      const forwardReturn = (currentSnapshot.raw.price - pastSnapshot.raw.price) / pastSnapshot.raw.price * 100;
      this.applyDecay(); // slight decay before adding new sample
      this.processSample(pastSnapshot.features, forwardReturn);

      if (this.calibrationSource === 'bootstrap') {
        this.calibrationSource = 'both';
      } else if (this.calibrationSource === 'none') {
        this.calibrationSource = 'live';
      }
    }
  }

  // ─── Build full profiler state for UI ───────────────────────────────────

  getState(): IndicatorProfilerState {
    const { minSamplesPerBin, topN } = this.config;
    const profiles: IndicatorProfile[] = [];
    const overallProfitRate = this.totalSamples > 0
      ? this.profitableSamples / this.totalSamples : 0;

    let matchCount = 0;
    let weightedMatch = 0;
    let totalWeight = 0;

    for (let f = 0; f < RL_FEATURE_DIM; f++) {
      const featureBins = this.bins[f];
      const currentVal = this.currentFeatures[f];
      const currentBinIdx = this.findBin(f, currentVal);

      // Find optimal bin (highest profitProb with enough samples)
      let bestIdx = 0;
      let bestProb = 0;
      let worstIdx = 0;
      let worstProb = 1;

      for (let b = 0; b < featureBins.length; b++) {
        const bin = featureBins[b];
        if (bin.totalCount >= minSamplesPerBin) {
          if (bin.profitProb > bestProb) {
            bestProb = bin.profitProb;
            bestIdx = b;
          }
          if (bin.profitProb < worstProb) {
            worstProb = bin.profitProb;
            worstIdx = b;
          }
        }
      }

      // Discriminative power: how much the optimal bin differs from average
      const power = Math.abs(bestProb - overallProfitRate);

      // Alignment: how close current value is to the optimal bin center
      const optBin = featureBins[bestIdx];
      const optCenter = (optBin.min === -Infinity ? optBin.max - 1 :
                         optBin.max === Infinity ? optBin.min + 1 :
                         (optBin.min + optBin.max) / 2);
      const optWidth = (optBin.max === Infinity || optBin.min === -Infinity)
        ? 2 : (optBin.max - optBin.min);
      const dist = Math.abs(currentVal - optCenter);
      const alignment = Math.max(0, 1 - dist / Math.max(optWidth * 2, 1e-8));

      const isInOptimal = currentBinIdx === bestIdx;
      if (isInOptimal) matchCount++;

      weightedMatch += isInOptimal ? power : 0;
      totalWeight += power;

      profiles.push({
        featureIndex: f,
        featureName: RL_FEATURE_NAMES[f],
        bins: featureBins.map(b => ({ ...b })),
        optimalBinIdx: bestIdx,
        optimalRange: [optBin.min, optBin.max],
        optimalProfitProb: bestProb,
        worstBinIdx: worstIdx,
        worstProfitProb: worstProb,
        currentValue: currentVal,
        currentBinIdx: currentBinIdx,
        isInOptimal,
        alignment,
        discriminativePower: power,
      });
    }

    // Rank by discriminative power
    const ranked = [...profiles].sort((a, b) => b.discriminativePower - a.discriminativePower);
    const topIndicators = ranked.slice(0, topN).map(p => ({
      name: p.featureName,
      profitProb: p.optimalProfitProb,
      power: p.discriminativePower,
    }));
    const bottomIndicators = ranked.slice(-topN).reverse().map(p => ({
      name: p.featureName,
      profitProb: p.optimalProfitProb,
      power: p.discriminativePower,
    }));

    return {
      profiles,
      totalSamples: Math.round(this.totalSamples),
      profitableSamples: Math.round(this.profitableSamples),
      overallProfitRate,
      matchScore: RL_FEATURE_DIM > 0 ? matchCount / RL_FEATURE_DIM : 0,
      weightedMatchScore: totalWeight > 0 ? weightedMatch / totalWeight : 0,
      topIndicators,
      bottomIndicators,
      calibrationSource: this.calibrationSource,
      lastUpdate: Date.now(),
    };
  }

  // ─── Get compact state for radar display (top indicators only) ──────────

  getRadarData(): { label: string; current: number; optimal: number; profitProb: number; alignment: number; power: number }[] {
    const profiles = this.getProfiles();
    return profiles
      .sort((a, b) => b.discriminativePower - a.discriminativePower)
      .slice(0, this.config.topN)
      .map(p => {
        const optBin = p.bins[p.optimalBinIdx];
        const optCenter = (optBin.min === -Infinity ? optBin.max - 0.5 :
                           optBin.max === Infinity ? optBin.min + 0.5 :
                           (optBin.min + optBin.max) / 2);
        return {
          label: p.featureName,
          current: p.currentValue,
          optimal: optCenter,
          profitProb: p.optimalProfitProb,
          alignment: p.alignment,
          power: p.discriminativePower,
        };
      });
  }

  // ─── Internal profile access ────────────────────────────────────────────

  private getProfiles(): IndicatorProfile[] {
    return this.getState().profiles;
  }

  isCalibrated(): boolean {
    return this.calibrated;
  }

  getConfig(): IndicatorProfilerConfig {
    return { ...this.config };
  }

  reset(): void {
    this.initBins();
    this.totalSamples = 0;
    this.profitableSamples = 0;
    this.calibrated = false;
    this.calibrationSource = 'none';
    this.currentFeatures = new Array(RL_FEATURE_DIM).fill(0);
  }
}

export default IndicatorProfiler;
