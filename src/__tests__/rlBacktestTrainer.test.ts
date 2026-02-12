import { describe, it, expect } from 'vitest';
import RLDataCollector, { RL_FEATURE_DIM } from '../app/components/TradingEngine/RLDataCollector';
import RLBacktestTrainer, { RLAction, ACTION_SIZE } from '../app/components/TradingEngine/RLBacktestTrainer';
import type { TechnicalState } from '../app/components/TradingEngine/TechnicalIndicators';

// ─── Mock TechnicalState ─────────────────────────────────────────────────────

function mockTechnicals(rsiValue = 50, macdHist = 0): TechnicalState {
  return {
    rsi: { value: rsiValue, isOverbought: rsiValue > 70, isOversold: rsiValue < 30, inRange: rsiValue > 30 && rsiValue < 70 },
    macd: { macdLine: macdHist, signalLine: 0, histogram: macdHist, bullishCrossover: false, bearishCrossover: false, aligned: macdHist > 0 ? 'bullish' : macdHist < 0 ? 'bearish' : 'neutral' },
    atr: { value: 0.5, percentile: 0.5, isExtreme: false, isNormal: true },
    bollingerBands: { upper: 101, middle: 100, lower: 99, bandwidth: 0.02, percentB: 0.5, squeeze: false },
    stochastic: { k: 50, d: 50, isOverbought: false, isOversold: false, bullishCrossover: false, bearishCrossover: false },
    adx: { adx: 25, pdi: 15, mdi: 10, isTrending: true, isStrong: false, bullishDI: true },
  };
}

// ─── RLDataCollector ─────────────────────────────────────────────────────────

describe('RLDataCollector', () => {
  it('creates snapshots with correct feature dimension', () => {
    const collector = new RLDataCollector();
    const snap = collector.collect(100, mockTechnicals(), null, 0.1, 0.01, 50);
    expect(snap.features.length).toBe(RL_FEATURE_DIM);
    expect(snap.price).toBe(100);
    expect(snap.raw.obi).toBe(0.1);
  });

  it('accumulates buffer over multiple ticks', () => {
    const collector = new RLDataCollector();
    for (let i = 0; i < 200; i++) {
      collector.collect(100 + i * 0.01, mockTechnicals(50 + i * 0.1), null, 0.05, 0.01, 50);
    }
    expect(collector.getBuffer().length).toBe(200);
    expect(collector.getTickCount()).toBe(200);
  });

  it('prunes buffer beyond max capacity', () => {
    const collector = new RLDataCollector({ maxSnapshots: 50, maxDurationMs: 6 * 60 * 60 * 1000 });
    for (let i = 0; i < 100; i++) {
      collector.collect(100 + Math.sin(i) * 2, mockTechnicals(), null, 0, 0.01, 50);
    }
    expect(collector.getBuffer().length).toBeLessThanOrEqual(50);
  });

  it('features are clamped to [-10, 10]', () => {
    const collector = new RLDataCollector();
    // Feed extreme values
    const tech = mockTechnicals(99, 999);
    const snap = collector.collect(100, tech, null, 1, 100, 99999);
    for (const f of snap.features) {
      expect(f).toBeGreaterThanOrEqual(-10);
      expect(f).toBeLessThanOrEqual(10);
    }
  });

  it('getState returns valid collector state', () => {
    const collector = new RLDataCollector();
    for (let i = 0; i < 10; i++) {
      collector.collect(100 + i, mockTechnicals(), null, 0, 0.01, 50);
    }
    const state = collector.getState();
    expect(state.bufferSize).toBe(10);
    expect(state.tickCount).toBe(10);
    expect(state.featureDim).toBe(RL_FEATURE_DIM);
    expect(state.ema9).toBeGreaterThan(0);
  });

  it('reset clears all state', () => {
    const collector = new RLDataCollector();
    for (let i = 0; i < 50; i++) {
      collector.collect(100 + i, mockTechnicals(), null, 0, 0.01, 50);
    }
    collector.reset();
    expect(collector.getBuffer().length).toBe(0);
    expect(collector.getTickCount()).toBe(0);
  });

  it('EMA values converge with stable prices', () => {
    const collector = new RLDataCollector();
    for (let i = 0; i < 250; i++) {
      collector.collect(100, mockTechnicals(), null, 0, 0.01, 50);
    }
    const state = collector.getState();
    // All EMAs should converge to ~100
    expect(Math.abs(state.ema9 - 100)).toBeLessThan(1);
    expect(Math.abs(state.ema21 - 100)).toBeLessThan(1);
    expect(Math.abs(state.ema50 - 100)).toBeLessThan(1);
    expect(Math.abs(state.ema200 - 100)).toBeLessThan(2);
  });
});

// ─── RLBacktestTrainer ───────────────────────────────────────────────────────

describe('RLBacktestTrainer', () => {
  it('starts in non-warmed-up state', () => {
    const trainer = new RLBacktestTrainer();
    const state = trainer.getState();
    expect(state.isWarmedUp).toBe(false);
    expect(state.totalTrainSteps).toBe(0);
    expect(state.epsilon).toBe(1.0);
    trainer.dispose();
  });

  it('infers action on every tick', () => {
    const collector = new RLDataCollector();
    const trainer = new RLBacktestTrainer({ minBufferSize: 1000 });

    // Feed some data
    for (let i = 0; i < 10; i++) {
      const snap = collector.collect(100 + Math.sin(i) * 2, mockTechnicals(), null, 0, 0.01, 50);
      const state = trainer.tick(snap, collector.getBuffer());
      expect(state.currentAction).toBeGreaterThanOrEqual(0);
      expect(state.currentAction).toBeLessThan(ACTION_SIZE);
    }
    trainer.dispose();
  });

  it('trains after reaching minBufferSize at trainEveryTicks interval', () => {
    const collector = new RLDataCollector();
    const trainer = new RLBacktestTrainer({
      minBufferSize: 100,
      trainEveryTicks: 100,
      batchSize: 16,
      lookAheadTicks: 10,
    });

    // Fill buffer to trigger training
    for (let i = 0; i < 200; i++) {
      const price = 100 + Math.sin(i * 0.1) * 5 + i * 0.01;
      const snap = collector.collect(price, mockTechnicals(50 + Math.sin(i) * 20), null, Math.sin(i) * 0.3, 0.01, 50);
      trainer.tick(snap, collector.getBuffer());
    }

    const state = trainer.getState();
    // Should have trained at tick 100 and 200
    expect(state.isWarmedUp).toBe(true);
    expect(state.totalTrainSteps).toBeGreaterThanOrEqual(1);
    expect(state.replayBufferSize).toBeGreaterThan(0);
    expect(state.epsilon).toBeLessThan(1.0); // epsilon should have decayed

    trainer.dispose();
  });

  it('getCurrentSignal returns valid direction and confidence', () => {
    const trainer = new RLBacktestTrainer();
    const signal = trainer.getCurrentSignal();
    expect(signal.direction).toBeGreaterThanOrEqual(-1);
    expect(signal.direction).toBeLessThanOrEqual(1);
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
    trainer.dispose();
  });

  it('backtest stats are populated after training', () => {
    const collector = new RLDataCollector();
    const trainer = new RLBacktestTrainer({
      minBufferSize: 50,
      trainEveryTicks: 50,
      batchSize: 16,
      lookAheadTicks: 10,
    });

    for (let i = 0; i < 100; i++) {
      const price = 100 + Math.sin(i * 0.05) * 3;
      const snap = collector.collect(price, mockTechnicals(), null, 0, 0.01, 50);
      trainer.tick(snap, collector.getBuffer());
    }

    const state = trainer.getState();
    expect(state.lastBacktestTrades).toBeGreaterThan(0);
    // Win rate should be between 0 and 1
    expect(state.lastBacktestWinRate).toBeGreaterThanOrEqual(0);
    expect(state.lastBacktestWinRate).toBeLessThanOrEqual(1);

    trainer.dispose();
  });

  it('epsilon decays over training steps', () => {
    const collector = new RLDataCollector();
    const trainer = new RLBacktestTrainer({
      minBufferSize: 50,
      trainEveryTicks: 50,
      batchSize: 16,
      lookAheadTicks: 10,
      epsilonStart: 1.0,
      epsilonDecay: 0.99,
    });

    const epsilonBefore = trainer.getState().epsilon;

    for (let i = 0; i < 100; i++) {
      const snap = collector.collect(100 + i * 0.1, mockTechnicals(), null, 0, 0.01, 50);
      trainer.tick(snap, collector.getBuffer());
    }

    const epsilonAfter = trainer.getState().epsilon;
    expect(epsilonAfter).toBeLessThan(epsilonBefore);

    trainer.dispose();
  });
});
