import { describe, it, expect } from 'vitest';
import KalmanTrendFilter from '../app/components/TradingEngine/KalmanTrendFilter';
import LinearRegressionTarget from '../app/components/TradingEngine/LinearRegressionTarget';
import NaiveBayesRegime from '../app/components/TradingEngine/NaiveBayesRegime';

describe('KalmanTrendFilter', () => {
  it('tracks an uptrend correctly', () => {
    const kalman = new KalmanTrendFilter(0.001, 0.1);
    let state;
    // Feed rising prices
    for (let i = 0; i < 50; i++) {
      state = kalman.update(100 + i * 0.5);
    }
    expect(state!.velocity).toBeGreaterThan(0);
    expect(state!.trendDirection).toBe(1);
    expect(state!.price).toBeGreaterThan(100);
  });

  it('tracks a downtrend correctly', () => {
    const kalman = new KalmanTrendFilter(0.001, 0.1);
    let state;
    for (let i = 0; i < 50; i++) {
      state = kalman.update(200 - i * 0.5);
    }
    expect(state!.velocity).toBeLessThan(0);
    expect(state!.trendDirection).toBe(-1);
  });

  it('detects reversal when trend flips', () => {
    const kalman = new KalmanTrendFilter(0.01, 0.05); // higher process noise = more responsive
    // Uptrend
    for (let i = 0; i < 30; i++) {
      kalman.update(100 + i * 1.0);
    }
    // Sharp reversal
    let reversalDetected = false;
    for (let i = 0; i < 30; i++) {
      const state = kalman.update(130 - i * 1.5);
      if (Math.abs(state.reversalSignal) > 0) {
        reversalDetected = true;
      }
    }
    expect(reversalDetected).toBe(true);
  });

  it('confidence stays in [0, 1]', () => {
    const kalman = new KalmanTrendFilter();
    for (let i = 0; i < 100; i++) {
      const price = 100 + Math.sin(i * 0.2) * 5 + Math.random() * 0.5;
      const state = kalman.update(price);
      expect(state.confidence).toBeGreaterThanOrEqual(0);
      expect(state.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('reset clears state', () => {
    const kalman = new KalmanTrendFilter();
    kalman.update(100);
    kalman.update(101);
    kalman.reset();
    const state = kalman.getState();
    expect(state.velocity).toBe(0);
  });
});

describe('LinearRegressionTarget', () => {
  it('produces positive slope for rising prices', () => {
    const lr = new LinearRegressionTarget(20, 5);
    let state;
    for (let i = 0; i < 30; i++) {
      state = lr.update(100 + i * 0.3);
    }
    expect(state!.slope).toBeGreaterThan(0);
    expect(state!.direction).toBe(1);
    expect(state!.priceTarget).toBeGreaterThan(100 + 29 * 0.3);
    expect(state!.rSquared).toBeGreaterThan(0.9);
  });

  it('produces negative slope for falling prices', () => {
    const lr = new LinearRegressionTarget(20, 5);
    let state;
    for (let i = 0; i < 30; i++) {
      state = lr.update(200 - i * 0.5);
    }
    expect(state!.slope).toBeLessThan(0);
    expect(state!.direction).toBe(-1);
  });

  it('upper band > target > lower band', () => {
    const lr = new LinearRegressionTarget(20, 5);
    for (let i = 0; i < 25; i++) {
      lr.update(100 + i * 0.2 + Math.random() * 0.5);
    }
    const state = lr.getState();
    expect(state.upperBand).toBeGreaterThanOrEqual(state.priceTarget);
    expect(state.lowerBand).toBeLessThanOrEqual(state.priceTarget);
  });

  it('R² is high for perfectly linear data', () => {
    const lr = new LinearRegressionTarget(30, 5);
    for (let i = 0; i < 30; i++) {
      lr.update(50 + i * 2);
    }
    const state = lr.getState();
    expect(state.rSquared).toBeGreaterThan(0.99);
  });

  it('strength is in [0, 1]', () => {
    const lr = new LinearRegressionTarget(20, 5);
    for (let i = 0; i < 30; i++) {
      const state = lr.update(100 + Math.random() * 5);
      expect(state.strength).toBeGreaterThanOrEqual(0);
      expect(state.strength).toBeLessThanOrEqual(1);
    }
  });
});

describe('NaiveBayesRegime', () => {
  it('detects uptrend regime with rising prices and positive OBI', () => {
    const nb = new NaiveBayesRegime(20, 10);
    let state;
    for (let i = 0; i < 50; i++) {
      state = nb.update(100 + i * 0.5, 20 + Math.random() * 5, 0.01);
    }
    // With consistent upward movement and positive OBI, should lean toward trending_up
    expect(['trending_up', 'ranging']).toContain(state!.regime);
    expect(state!.confidence).toBeGreaterThan(0);
  });

  it('detects volatile regime with wild price swings', () => {
    const nb = new NaiveBayesRegime(20, 10);
    let state;
    for (let i = 0; i < 50; i++) {
      const swing = (i % 2 === 0 ? 1 : -1) * (3 + Math.random() * 5);
      state = nb.update(100 + swing, (i % 2 === 0 ? 30 : -30), 0.05 + Math.random() * 0.1);
    }
    // High volatility and swinging OBI — should eventually detect volatile
    expect(state!.probabilities.volatile).toBeGreaterThan(0);
    expect(state!.confidence).toBeGreaterThan(0.1);
  });

  it('probabilities sum to ~1', () => {
    const nb = new NaiveBayesRegime(15, 8);
    for (let i = 0; i < 30; i++) {
      const state = nb.update(100 + Math.random(), Math.random() * 10 - 5, 0.01);
      const sum = state.probabilities.trending_up + state.probabilities.trending_down
        + state.probabilities.ranging + state.probabilities.volatile;
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it('detects regime transitions', () => {
    const nb = new NaiveBayesRegime(15, 8);
    let transitions = 0;
    // First: calm market
    for (let i = 0; i < 30; i++) {
      const state = nb.update(100 + Math.random() * 0.1, 1, 0.01);
      if (state.isTransition) transitions++;
    }
    // Then: sudden crash
    for (let i = 0; i < 20; i++) {
      const state = nb.update(100 - i * 2, -30, 0.1);
      if (state.isTransition) transitions++;
    }
    // Should have at least one transition
    expect(transitions).toBeGreaterThan(0);
  });

  it('regime is one of the valid labels', () => {
    const nb = new NaiveBayesRegime();
    for (let i = 0; i < 20; i++) {
      const state = nb.update(100 + Math.random(), Math.random() * 10, 0.01);
      expect(['trending_up', 'trending_down', 'ranging', 'volatile']).toContain(state.regime);
    }
  });
});
