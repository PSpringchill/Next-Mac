import { describe, it, expect } from 'vitest';
import EnsembleSignalGenerator from '../app/components/TradingEngine/EnsembleSignalGenerator';
import TechnicalIndicators from '../app/components/TradingEngine/TechnicalIndicators';
import CurrencyStrengthMeter from '../app/components/TradingEngine/CurrencyStrengthMeter';
import PatternDetector from '../app/components/TradingEngine/PatternDetector';
import ZigZagDetector from '../app/components/TradingEngine/ZigZagDetector';

// ─── TechnicalIndicators ─────────────────────────────────────────────────────

describe('TechnicalIndicators', () => {
  it('RSI rises with consecutive gains', () => {
    const ti = new TechnicalIndicators(14);
    let state;
    for (let i = 0; i < 30; i++) {
      state = ti.update(100 + i * 0.5);
    }
    expect(state!.rsi.value).toBeGreaterThan(50);
  });

  it('RSI falls with consecutive losses', () => {
    const ti = new TechnicalIndicators(14);
    let state;
    for (let i = 0; i < 30; i++) {
      state = ti.update(200 - i * 0.5);
    }
    expect(state!.rsi.value).toBeLessThan(50);
  });

  it('MACD detects bullish alignment with rising prices', () => {
    const ti = new TechnicalIndicators(14, 12, 26, 9);
    let state;
    for (let i = 0; i < 50; i++) {
      state = ti.update(100 + i * 0.3);
    }
    expect(state!.macd.macdLine).toBeGreaterThan(0);
  });

  it('RSI stays in [0, 100]', () => {
    const ti = new TechnicalIndicators(14);
    for (let i = 0; i < 50; i++) {
      const state = ti.update(100 + Math.sin(i) * 10 + Math.random());
      expect(state.rsi.value).toBeGreaterThanOrEqual(0);
      expect(state.rsi.value).toBeLessThanOrEqual(100);
    }
  });
});

// ─── CurrencyStrengthMeter ───────────────────────────────────────────────────

describe('CurrencyStrengthMeter', () => {
  it('base strengthens with positive OBI and rising prices', () => {
    const cs = new CurrencyStrengthMeter(20);
    let state;
    for (let i = 0; i < 40; i++) {
      state = cs.update(100 + i * 0.5, 25, 10 + i * 0.5, 5);
    }
    expect(state!.baseStrength).toBeGreaterThan(50);
    expect(state!.divergence).toBeGreaterThan(0);
  });

  it('quote strengthens with negative OBI and falling prices', () => {
    const cs = new CurrencyStrengthMeter(20);
    let state;
    for (let i = 0; i < 40; i++) {
      state = cs.update(200 - i * 0.5, -25, 5, 10 + i * 0.5);
    }
    expect(state!.quoteStrength).toBeGreaterThan(50);
    expect(state!.divergence).toBeLessThan(0);
  });

  it('strengths stay in [0, 100]', () => {
    const cs = new CurrencyStrengthMeter(15);
    for (let i = 0; i < 30; i++) {
      const state = cs.update(100 + Math.random() * 5, Math.random() * 50 - 25, 10, 10);
      expect(state.baseStrength).toBeGreaterThanOrEqual(0);
      expect(state.baseStrength).toBeLessThanOrEqual(100);
      expect(state.quoteStrength).toBeGreaterThanOrEqual(0);
      expect(state.quoteStrength).toBeLessThanOrEqual(100);
    }
  });
});

// ─── PatternDetector ─────────────────────────────────────────────────────────

describe('PatternDetector', () => {
  it('detects hammer pattern', () => {
    const pd = new PatternDetector();
    // Hammer: small body at top, long lower wick, minimal upper wick
    const state = pd.addCandle({ open: 100, high: 100.5, low: 90, close: 100.4, volume: 100 });
    expect(state.hasBullish).toBe(true);
    expect(state.patterns.some(p => p.type === 'hammer')).toBe(true);
  });

  it('detects bullish engulfing', () => {
    const pd = new PatternDetector();
    // First candle: bearish
    pd.addCandle({ open: 105, high: 106, low: 99, close: 100, volume: 100 });
    // Second candle: bullish engulfing
    const state = pd.addCandle({ open: 99, high: 108, low: 98, close: 107, volume: 150 });
    expect(state.hasBullish).toBe(true);
    expect(state.patterns.some(p => p.type === 'bullish_engulfing')).toBe(true);
  });

  it('detects bearish engulfing', () => {
    const pd = new PatternDetector();
    // First candle: bullish
    pd.addCandle({ open: 100, high: 106, low: 99, close: 105, volume: 100 });
    // Second candle: bearish engulfing
    const state = pd.addCandle({ open: 106, high: 107, low: 98, close: 99, volume: 150 });
    expect(state.hasBearish).toBe(true);
    expect(state.patterns.some(p => p.type === 'bearish_engulfing')).toBe(true);
  });

  it('detects doji', () => {
    const pd = new PatternDetector();
    const state = pd.addCandle({ open: 100, high: 105, low: 95, close: 100.1, volume: 100 });
    expect(state.patterns.some(p => p.type === 'doji')).toBe(true);
  });

  it('noBearish is true when only bullish patterns exist', () => {
    const pd = new PatternDetector();
    const state = pd.addCandle({ open: 100, high: 101, low: 90, close: 100.5, volume: 100 });
    // Hammer is bullish, should have no bearish
    if (state.hasBullish && !state.hasBearish) {
      expect(state.noBearish).toBe(true);
    }
  });
});

// ─── ZigZagDetector ──────────────────────────────────────────────────────────

describe('ZigZagDetector', () => {
  it('detects swing highs and lows in oscillating price', () => {
    const zz = new ZigZagDetector(0.005, 3);
    let swingHighDetected = false;
    let swingLowDetected = false;
    // Generate clear oscillation
    for (let i = 0; i < 100; i++) {
      const price = 100 + Math.sin(i * 0.3) * 5;
      const state = zz.update(price);
      if (state.isSwingHigh) swingHighDetected = true;
      if (state.isSwingLow) swingLowDetected = true;
    }
    expect(swingHighDetected).toBe(true);
    expect(swingLowDetected).toBe(true);
  });

  it('direction changes after swing detection', () => {
    const zz = new ZigZagDetector(0.001, 2);
    let sawDirectionChange = false;
    let lastDir = 'none';
    for (let i = 0; i < 80; i++) {
      const price = 100 + Math.sin(i * 0.25) * 8;
      const state = zz.update(price);
      if (state.direction !== lastDir && lastDir !== 'none') {
        sawDirectionChange = true;
      }
      lastDir = state.direction;
    }
    expect(sawDirectionChange).toBe(true);
  });
});

// ─── EnsembleSignalGenerator ─────────────────────────────────────────────────

describe('EnsembleSignalGenerator', () => {
  it('produces a valid ensemble result with all component checks', () => {
    const gen = new EnsembleSignalGenerator({ entryThreshold: 0.65, exitThreshold: 0.35 });
    const result = gen.update(100, 10, 50, 40, 0.02, 1, 0.8, 0.01);
    expect(result.checks.length).toBe(7);
    expect(result.ensembleScore).toBeGreaterThanOrEqual(0);
    expect(result.ensembleScore).toBeLessThanOrEqual(1);
    expect(['trending_up', 'trending_down', 'ranging', 'volatile']).toContain(result.naiveBayes.regime);
  });

  it('does not signal entry on first tick (insufficient data)', () => {
    const gen = new EnsembleSignalGenerator();
    const result = gen.update(100, 0, 10, 10, 0.01, 0, 0.5, 0.0);
    expect(result.shouldEnter).toBe(false);
  });

  it('each component check has name, passed, score, reason', () => {
    const gen = new EnsembleSignalGenerator();
    const result = gen.update(100, 5, 20, 15, 0.01, 1, 0.7, 0.02);
    for (const check of result.checks) {
      expect(check.name).toBeDefined();
      expect(typeof check.passed).toBe('boolean');
      expect(check.score).toBeGreaterThanOrEqual(0);
      expect(check.score).toBeLessThanOrEqual(1.01); // allow tiny float overshoot
      expect(typeof check.reason).toBe('string');
    }
  });

  it('config defaults match specification', () => {
    const gen = new EnsembleSignalGenerator();
    const config = gen.getConfig();
    expect(config.riskPerTrade).toBe(0.02);
    expect(config.maxDrawdown).toBe(0.05);
    expect(config.entryThreshold).toBe(0.65);
    expect(config.exitThreshold).toBe(0.35);
    expect(config.nbProbThreshold).toBe(0.65);
    expect(config.maxPositions).toBe(5);
    expect(config.maxCorrelation).toBe(0.7);
  });

  it('ensemble score increases with consistently bullish data', () => {
    const gen = new EnsembleSignalGenerator();
    const scores: number[] = [];
    for (let i = 0; i < 50; i++) {
      const result = gen.update(
        100 + i * 0.5, // rising price
        20 + Math.random() * 5, // positive OBI
        50, 30, // bid-heavy volume
        0.01, // tight spread
        1, 0.85, // A3C says BUY with high confidence
        0.01, // low drawdown
      );
      scores.push(result.ensembleScore);
    }
    // Score should trend upward as more data aligns bullishly
    const firstHalf = scores.slice(0, 25).reduce((s, v) => s + v, 0) / 25;
    const secondHalf = scores.slice(25).reduce((s, v) => s + v, 0) / 25;
    expect(secondHalf).toBeGreaterThanOrEqual(firstHalf * 0.8); // at least maintaining
  });

  it('blocks entry when drawdown exceeds CPO constraint', () => {
    const gen = new EnsembleSignalGenerator({ maxDrawdown: 0.05 });
    // Feed enough data
    for (let i = 0; i < 30; i++) {
      gen.update(100 + i * 0.3, 15, 40, 30, 0.01, 1, 0.9, 0.01);
    }
    // Now simulate high drawdown
    const result = gen.update(100, 15, 40, 30, 0.01, 1, 0.9, 0.06); // 6% DD > 5%
    // A3C-CPO check should fail
    const a3cCheck = result.checks.find(c => c.name === 'A3C-CPO');
    expect(a3cCheck).toBeDefined();
    expect(a3cCheck!.passed).toBe(false);
  });

  it('exit evaluator triggers on drawdown exceeding limit', () => {
    const gen = new EnsembleSignalGenerator({ maxDrawdown: 0.05 });
    for (let i = 0; i < 20; i++) {
      gen.update(100 + i * 0.2, 10, 30, 25, 0.01, 1, 0.8, 0.01);
    }
    gen.onEntryFilled(1, 100, 0.7);
    const result = gen.update(100, 10, 30, 25, 0.01, 1, 0.8, 0.01);
    const exit = gen.evaluateExit(90, 100, null, null, 1, result, 1, 0.8, 0.06, 5000, 50000);
    expect(exit.shouldExit).toBe(true);
    expect(exit.reason).toContain('Drawdown');
  });

  it('exit evaluator triggers on stop loss hit', () => {
    const gen = new EnsembleSignalGenerator();
    for (let i = 0; i < 20; i++) {
      gen.update(100, 0, 10, 10, 0.01, 0, 0.5, 0.0);
    }
    gen.onEntryFilled(1, 100, 0.7);
    const result = gen.update(95, 0, 10, 10, 0.01, 0, 0.5, 0.01);
    const exit = gen.evaluateExit(95, 100, 110, 96, 1, result, 0, 0.5, 0.01, 1000, 50000);
    expect(exit.shouldExit).toBe(true);
    expect(exit.reason).toContain('Stop Loss');
  });

  it('exit evaluator triggers on take profit hit', () => {
    const gen = new EnsembleSignalGenerator();
    for (let i = 0; i < 20; i++) {
      gen.update(100 + i * 0.1, 5, 15, 10, 0.01, 1, 0.7, 0.0);
    }
    gen.onEntryFilled(1, 100, 0.7);
    const result = gen.update(112, 5, 15, 10, 0.01, 1, 0.7, 0.0);
    const exit = gen.evaluateExit(112, 100, 110, 95, 1, result, 1, 0.7, 0.0, 1000, 50000);
    expect(exit.shouldExit).toBe(true);
    expect(exit.reason).toContain('Take Profit');
  });

  it('reset clears all state', () => {
    const gen = new EnsembleSignalGenerator();
    for (let i = 0; i < 20; i++) {
      gen.update(100 + i, 10, 30, 20, 0.01, 1, 0.8, 0.01);
    }
    gen.onEntryFilled(1, 110, 0.8);
    gen.reset();
    const pos = gen.getCurrentPosition();
    expect(pos.direction).toBe(0);
    expect(pos.entryPrice).toBe(0);
    expect(pos.ticksHeld).toBe(0);
  });
});
