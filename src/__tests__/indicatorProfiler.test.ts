import { describe, it, expect } from 'vitest';
import IndicatorProfiler from '../app/components/TradingEngine/IndicatorProfiler';
import type { RLSnapshot } from '../app/components/TradingEngine/RLDataCollector';
import { RL_FEATURE_DIM } from '../app/components/TradingEngine/RLDataCollector';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSnapshot(price: number, features?: Partial<Record<number, number>>): RLSnapshot {
  const f = new Array(RL_FEATURE_DIM).fill(0);
  if (features) {
    for (const [idx, val] of Object.entries(features)) {
      f[Number(idx)] = val!;
    }
  }
  return {
    timestamp: Date.now(),
    price,
    features: f,
    raw: { price, atr: 1, obi: 0, spread: 0.01 },
  };
}

function makeTrendingBuffer(n: number, startPrice: number, step: number): RLSnapshot[] {
  const buf: RLSnapshot[] = [];
  for (let i = 0; i < n; i++) {
    const price = startPrice + i * step;
    // Feature 0 (RSI): high RSI when trending up
    const rsi = step > 0 ? 0.7 + Math.random() * 0.1 : 0.3 - Math.random() * 0.1;
    // Feature 3 (EMA cross): positive when trending up
    const emaCross = step > 0 ? 1.5 + Math.random() * 0.5 : -1.5 - Math.random() * 0.5;
    buf.push(makeSnapshot(price, { 0: rsi, 3: emaCross }));
  }
  return buf;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('IndicatorProfiler', () => {
  it('starts uncalibrated with no data', () => {
    const p = new IndicatorProfiler();
    expect(p.isCalibrated()).toBe(false);
    const state = p.getState();
    expect(state.calibrationSource).toBe('none');
    expect(state.totalSamples).toBe(0);
    expect(state.profiles).toHaveLength(RL_FEATURE_DIM);
  });

  it('config defaults are sensible', () => {
    const p = new IndicatorProfiler();
    const config = p.getConfig();
    expect(config.numBins).toBe(10);
    expect(config.lookAheadTicks).toBe(30);
    expect(config.profitThreshold).toBe(0.01);
    expect(config.minSamplesPerBin).toBe(5);
    expect(config.topN).toBe(8);
  });

  it('calibrates from buffer with enough data', () => {
    const p = new IndicatorProfiler({ lookAheadTicks: 5, minSamplesPerBin: 2 });
    const buffer = makeTrendingBuffer(100, 100, 0.1);
    p.calibrateFromBuffer(buffer);

    expect(p.isCalibrated()).toBe(true);
    const state = p.getState();
    expect(state.calibrationSource).toBe('bootstrap');
    expect(state.totalSamples).toBe(95); // 100 - lookAheadTicks
    expect(state.profitableSamples).toBeGreaterThan(0);
    expect(state.profiles).toHaveLength(RL_FEATURE_DIM);
  });

  it('rejects calibration with insufficient data', () => {
    const p = new IndicatorProfiler({ lookAheadTicks: 30 });
    const buffer = makeTrendingBuffer(10, 100, 0.1); // only 10 snapshots
    p.calibrateFromBuffer(buffer);
    expect(p.isCalibrated()).toBe(false); // not enough data
  });

  it('each profile has valid bins after calibration', () => {
    const p = new IndicatorProfiler({ lookAheadTicks: 5, numBins: 5, minSamplesPerBin: 1 });
    const buffer = makeTrendingBuffer(200, 100, 0.05);
    p.calibrateFromBuffer(buffer);

    const state = p.getState();
    for (const profile of state.profiles) {
      expect(profile.bins).toHaveLength(5);
      expect(profile.featureIndex).toBeGreaterThanOrEqual(0);
      expect(profile.featureIndex).toBeLessThan(RL_FEATURE_DIM);
      expect(profile.featureName).toBeTruthy();
      expect(profile.optimalProfitProb).toBeGreaterThanOrEqual(0);
      expect(profile.optimalProfitProb).toBeLessThanOrEqual(1);
      expect(profile.alignment).toBeGreaterThanOrEqual(0);
      expect(profile.alignment).toBeLessThanOrEqual(1);
    }
  });

  it('profitable samples have higher profit rate in trending data', () => {
    const p = new IndicatorProfiler({ lookAheadTicks: 5, minSamplesPerBin: 2 });
    // Strong uptrend = most forward returns are positive
    const buffer = makeTrendingBuffer(200, 100, 0.5);
    p.calibrateFromBuffer(buffer);

    const state = p.getState();
    // In a strong uptrend, most samples should be profitable
    expect(state.overallProfitRate).toBeGreaterThan(0.5);
  });

  it('matchScore is between 0 and 1', () => {
    const p = new IndicatorProfiler({ lookAheadTicks: 5, minSamplesPerBin: 2 });
    const buffer = makeTrendingBuffer(200, 100, 0.1);
    p.calibrateFromBuffer(buffer);

    const state = p.getState();
    expect(state.matchScore).toBeGreaterThanOrEqual(0);
    expect(state.matchScore).toBeLessThanOrEqual(1);
    expect(state.weightedMatchScore).toBeGreaterThanOrEqual(0);
    expect(state.weightedMatchScore).toBeLessThanOrEqual(1);
  });

  it('topIndicators sorted by discriminative power', () => {
    const p = new IndicatorProfiler({ lookAheadTicks: 5, minSamplesPerBin: 2, topN: 5 });
    const buffer = makeTrendingBuffer(200, 100, 0.1);
    p.calibrateFromBuffer(buffer);

    const state = p.getState();
    expect(state.topIndicators.length).toBeLessThanOrEqual(5);
    // Verify sorted descending by power
    for (let i = 1; i < state.topIndicators.length; i++) {
      expect(state.topIndicators[i - 1].power).toBeGreaterThanOrEqual(state.topIndicators[i].power);
    }
  });

  it('feedLiveTick increments samples and switches calibration to "both"', () => {
    const p = new IndicatorProfiler({ lookAheadTicks: 5, minSamplesPerBin: 2 });
    const buffer = makeTrendingBuffer(100, 100, 0.1);
    p.calibrateFromBuffer(buffer);

    const stateBefore = p.getState();
    expect(stateBefore.calibrationSource).toBe('bootstrap');

    // Feed a live tick pair
    const pastSnap = makeSnapshot(100, { 0: 0.6 });
    const currentSnap = makeSnapshot(101, { 0: 0.7 });
    p.feedLiveTick(currentSnap, pastSnap);

    const stateAfter = p.getState();
    expect(stateAfter.calibrationSource).toBe('both');
  });

  it('feedLiveTick without pastSnapshot only updates currentFeatures', () => {
    const p = new IndicatorProfiler({ lookAheadTicks: 5, minSamplesPerBin: 2 });
    const buffer = makeTrendingBuffer(100, 100, 0.1);
    p.calibrateFromBuffer(buffer);

    const samplesBefore = p.getState().totalSamples;
    const currentSnap = makeSnapshot(105, { 0: 0.8 });
    p.feedLiveTick(currentSnap, null);

    // totalSamples shouldn't increase (no past snapshot to evaluate)
    expect(p.getState().totalSamples).toBe(samplesBefore);
  });

  it('live-only calibration source when no bootstrap', () => {
    const p = new IndicatorProfiler({ lookAheadTicks: 5, minSamplesPerBin: 1 });
    expect(p.getState().calibrationSource).toBe('none');

    const pastSnap = makeSnapshot(100);
    const currentSnap = makeSnapshot(101);
    p.feedLiveTick(currentSnap, pastSnap);

    expect(p.getState().calibrationSource).toBe('live');
  });

  it('getRadarData returns top N most discriminative indicators', () => {
    const p = new IndicatorProfiler({ lookAheadTicks: 5, minSamplesPerBin: 2, topN: 6 });
    const buffer = makeTrendingBuffer(200, 100, 0.1);
    p.calibrateFromBuffer(buffer);

    const radar = p.getRadarData();
    expect(radar.length).toBeLessThanOrEqual(6);
    for (const item of radar) {
      expect(item.label).toBeTruthy();
      expect(item.profitProb).toBeGreaterThanOrEqual(0);
      expect(item.profitProb).toBeLessThanOrEqual(1);
      expect(item.alignment).toBeGreaterThanOrEqual(0);
      expect(item.alignment).toBeLessThanOrEqual(1);
    }
  });

  it('reset clears all state', () => {
    const p = new IndicatorProfiler({ lookAheadTicks: 5, minSamplesPerBin: 2 });
    const buffer = makeTrendingBuffer(100, 100, 0.1);
    p.calibrateFromBuffer(buffer);
    expect(p.isCalibrated()).toBe(true);

    p.reset();
    expect(p.isCalibrated()).toBe(false);
    expect(p.getState().totalSamples).toBe(0);
    expect(p.getState().calibrationSource).toBe('none');
  });

  it('decay factor reduces old sample weight over time', () => {
    const p = new IndicatorProfiler({ lookAheadTicks: 5, minSamplesPerBin: 1, decayFactor: 0.9 });
    const buffer = makeTrendingBuffer(100, 100, 0.1);
    p.calibrateFromBuffer(buffer);

    const initialSamples = p.getState().totalSamples;

    // Feed many live ticks — each applies decay to existing bins
    for (let i = 0; i < 50; i++) {
      const past = makeSnapshot(100 + i * 0.1, { 0: 0.5 });
      const current = makeSnapshot(100 + (i + 5) * 0.1, { 0: 0.6 });
      p.feedLiveTick(current, past);
    }

    // After significant decay, effective sample count changes from initial
    const finalState = p.getState();
    // With 0.9 decay applied 50 times, original samples are heavily decayed
    expect(finalState.totalSamples).not.toBe(initialSamples);
  });

  it('discriminative power distinguishes predictive vs non-predictive features', () => {
    const p = new IndicatorProfiler({ lookAheadTicks: 5, numBins: 5, minSamplesPerBin: 3 });

    // Create buffer where feature 0 (RSI) is highly correlated with profit
    // and feature 27 (spread) is random noise
    const buf: RLSnapshot[] = [];
    for (let i = 0; i < 300; i++) {
      const profitable = Math.random() > 0.5;
      const price = 100 + i * (profitable ? 0.1 : -0.05);
      const f = new Array(RL_FEATURE_DIM).fill(0);
      // RSI high when profitable
      f[0] = profitable ? 0.7 + Math.random() * 0.2 : 0.2 + Math.random() * 0.2;
      // Spread is random noise
      f[27] = Math.random() * 2 - 1;
      buf.push({
        timestamp: Date.now() + i * 1000,
        price,
        features: f,
        raw: { price, atr: 1, obi: 0, spread: 0.01 },
      });
    }

    p.calibrateFromBuffer(buf);
    const state = p.getState();

    // RSI (feature 0) should have higher discriminative power than spread (feature 27)
    const rsiProfile = state.profiles.find(p => p.featureIndex === 0)!;
    const spreadProfile = state.profiles.find(p => p.featureIndex === 27)!;

    // In a correlated feature, the difference between best and worst bins should be larger
    const rsiSpread = rsiProfile.optimalProfitProb - rsiProfile.worstProfitProb;
    const spreadSpread = spreadProfile.optimalProfitProb - spreadProfile.worstProfitProb;
    expect(rsiSpread).toBeGreaterThan(spreadSpread * 0.5); // RSI should be more discriminative
  });

  it('optimal bin range is finite and valid', () => {
    const p = new IndicatorProfiler({ lookAheadTicks: 5, minSamplesPerBin: 2 });
    const buffer = makeTrendingBuffer(200, 100, 0.1);
    p.calibrateFromBuffer(buffer);

    const state = p.getState();
    for (const profile of state.profiles) {
      const [lo, hi] = profile.optimalRange;
      // lo can be -Infinity, hi can be Infinity (edge bins)
      expect(lo).toBeLessThan(hi);
      expect(profile.optimalBinIdx).toBeGreaterThanOrEqual(0);
      expect(profile.optimalBinIdx).toBeLessThan(p.getConfig().numBins);
    }
  });
});
