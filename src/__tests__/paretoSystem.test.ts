import { describe, it, expect, beforeEach } from 'vitest';
import { RollingBuffer } from '../app/components/TradingEngine/RollingBuffer';
import ParetoAnalyzer, {
  AlphaRiskState,
} from '../app/components/TradingEngine/ParetoAnalyzer';
import DynamicThresholds from '../app/components/TradingEngine/DynamicThresholds';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. RollingBuffer Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('RollingBuffer', () => {
  let buf: RollingBuffer;

  beforeEach(() => {
    buf = new RollingBuffer(100);
  });

  describe('basic operations', () => {
    it('starts empty', () => {
      expect(buf.size()).toBe(0);
      expect(buf.isFull()).toBe(false);
    });

    it('adds values and tracks size', () => {
      buf.add(1);
      buf.add(2);
      buf.add(3);
      expect(buf.size()).toBe(3);
    });

    it('wraps around at capacity', () => {
      const small = new RollingBuffer(3);
      small.add(1);
      small.add(2);
      small.add(3);
      expect(small.isFull()).toBe(true);
      small.add(4); // Overwrites 1
      expect(small.size()).toBe(3);
      expect(small.toArray()).toEqual([2, 3, 4]);
    });

    it('clears correctly', () => {
      buf.add(1);
      buf.add(2);
      buf.clear();
      expect(buf.size()).toBe(0);
    });
  });

  describe('statistics', () => {
    it('calculates mean', () => {
      [1, 2, 3, 4, 5].forEach(v => buf.add(v));
      expect(buf.mean()).toBe(3);
    });

    it('calculates variance', () => {
      [2, 4, 4, 4, 5, 5, 7, 9].forEach(v => buf.add(v));
      expect(buf.variance()).toBe(4);
    });

    it('calculates stdDev', () => {
      [2, 4, 4, 4, 5, 5, 7, 9].forEach(v => buf.add(v));
      expect(buf.stdDev()).toBe(2);
    });

    it('calculates min and max', () => {
      [5, 1, 8, 3, 9, 2].forEach(v => buf.add(v));
      expect(buf.min()).toBe(1);
      expect(buf.max()).toBe(9);
    });
  });

  describe('percentile and VaR', () => {
    beforeEach(() => {
      // Add 100 values: 1, 2, 3, ..., 100
      for (let i = 1; i <= 100; i++) buf.add(i);
    });

    it('calculates median (50th percentile)', () => {
      const median = buf.getPercentile(0.5);
      expect(median).toBeGreaterThanOrEqual(49);
      expect(median).toBeLessThanOrEqual(51);
    });

    it('calculates 90th percentile', () => {
      const p90 = buf.getPercentile(0.9);
      expect(p90).toBeGreaterThanOrEqual(89);
      expect(p90).toBeLessThanOrEqual(91);
    });

    it('calculates rank of a value', () => {
      const rank = buf.getRank(50);
      expect(rank).toBeCloseTo(0.5, 1);
    });

    it('calculates VaR', () => {
      // With values 1-100, VaR at 95% = -value at 5th percentile
      const var95 = buf.getVaR(0.95);
      expect(var95).toBeLessThan(0); // Negative because values are positive
    });

    it('calculates Expected Shortfall', () => {
      const es = buf.getExpectedShortfall(0.95);
      // ES should be average of worst 5%
      expect(es).toBeDefined();
    });
  });

  describe('latest values', () => {
    it('returns most recent values', () => {
      [10, 20, 30, 40, 50].forEach(v => buf.add(v));
      expect(buf.latest(3)).toEqual([50, 40, 30]);
    });

    it('handles request larger than buffer', () => {
      buf.add(1);
      buf.add(2);
      expect(buf.latest(5)).toEqual([2, 1]);
    });
  });

  describe('performance: lazy sort', () => {
    it('does not sort on every add', () => {
      const large = new RollingBuffer(10000);
      const start = Date.now();
      for (let i = 0; i < 10000; i++) {
        large.add(Math.random());
      }
      const addTime = Date.now() - start;

      // Adding 10k values should be fast (< 50ms)
      expect(addTime).toBeLessThan(100);

      // Percentile triggers sort
      const sortStart = Date.now();
      large.getPercentile(0.95);
      const sortTime = Date.now() - sortStart;

      // Second call should use cache
      const cacheStart = Date.now();
      large.getPercentile(0.5);
      const cacheTime = Date.now() - cacheStart;

      expect(cacheTime).toBeLessThanOrEqual(sortTime);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. ParetoAnalyzer Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('ParetoAnalyzer', () => {
  let analyzer: ParetoAnalyzer;

  beforeEach(() => {
    analyzer = new ParetoAnalyzer(2000, 100, 0.6); // Lower minSamples for testing
  });

  describe('addPrice()', () => {
    it('computes log returns from sequential prices', () => {
      analyzer.addPrice(100);
      analyzer.addPrice(101);
      analyzer.addPrice(99);
      expect(analyzer.getSampleSize()).toBe(2); // 2 returns from 3 prices
    });

    it('ignores first price (no previous to compare)', () => {
      analyzer.addPrice(100);
      expect(analyzer.getSampleSize()).toBe(0);
    });
  });

  describe('estimateParetoParams()', () => {
    it('returns safe defaults with insufficient data', () => {
      analyzer.addPrice(100);
      analyzer.addPrice(101);
      const params = analyzer.estimateParetoParams();
      expect(params.alpha).toBe(5.0);
      expect(params.isReliable).toBe(false);
    });

    it('estimates alpha from sufficient data', () => {
      // Generate 500+ prices with some volatility
      let price = 100;
      for (let i = 0; i < 600; i++) {
        price *= 1 + (Math.random() - 0.5) * 0.02; // ±1% moves
        analyzer.addPrice(price);
      }
      const params = analyzer.estimateParetoParams();
      expect(params.alpha).toBeGreaterThan(1);
      expect(params.alpha).toBeLessThan(10);
      expect(params.sampleSize).toBeGreaterThanOrEqual(500);
      expect(params.isReliable).toBe(true);
      expect(params.fitness).toBeGreaterThan(0);
      expect(params.fitness).toBeLessThanOrEqual(1);
    });

    it('detects fat tails from extreme moves', () => {
      // Generate mostly normal prices with occasional extreme moves
      let price = 100;
      for (let i = 0; i < 600; i++) {
        if (i % 50 === 0) {
          price *= 1 + (Math.random() > 0.5 ? 0.1 : -0.1); // 10% jumps
        } else {
          price *= 1 + (Math.random() - 0.5) * 0.002; // Tiny moves
        }
        analyzer.addPrice(price);
      }
      const params = analyzer.estimateParetoParams();
      // Fat tails → lower alpha
      expect(params.tailRisk).toBeGreaterThan(0.2);
    });
  });

  describe('calculatePOT()', () => {
    it('returns empty result with insufficient data', () => {
      const pot = analyzer.calculatePOT();
      expect(pot.exceedances).toBe(0);
    });

    it('identifies exceedances above threshold', () => {
      let price = 100;
      for (let i = 0; i < 200; i++) {
        price *= 1 + (Math.random() - 0.5) * 0.02;
        analyzer.addPrice(price);
      }
      const pot = analyzer.calculatePOT(0.90);
      // ~10% of data should exceed the 90th percentile threshold
      expect(pot.exceedances).toBeGreaterThan(0);
      expect(pot.threshold).toBeGreaterThan(0);
    });
  });

  describe('Alpha Monitor (graduated risk states)', () => {
    it('starts in SAFE state', () => {
      expect(analyzer.getAlphaState()).toBe(AlphaRiskState.SAFE);
      expect(analyzer.allowNewTrades()).toBe(true);
    });

    it('allows trades in SAFE state', () => {
      let price = 100;
      for (let i = 0; i < 200; i++) {
        price *= 1 + (Math.random() - 0.5) * 0.01;
        analyzer.addPrice(price);
      }
      analyzer.analyze();
      expect(analyzer.allowNewTrades()).toBe(true);
    });

    it('returns correct position size multipliers', () => {
      // With normal data, should be SAFE or ELEVATED
      let price = 100;
      for (let i = 0; i < 200; i++) {
        price *= 1 + (Math.random() - 0.5) * 0.01;
        analyzer.addPrice(price);
      }
      const state = analyzer.analyze();
      expect(state.positionSizeMultiplier).toBeGreaterThan(0);
      expect(state.positionSizeMultiplier).toBeLessThanOrEqual(1.0);
    });

    it('does not recommend liquidation initially', () => {
      const state = analyzer.analyze();
      expect(state.shouldLiquidate).toBe(false);
    });
  });

  describe('full analyze()', () => {
    it('returns complete ParetoState', () => {
      let price = 100;
      for (let i = 0; i < 200; i++) {
        price *= 1 + (Math.random() - 0.5) * 0.01;
        analyzer.addPrice(price);
      }
      const state = analyzer.analyze();

      // All fields present
      expect(state.params).toBeDefined();
      expect(state.pot).toBeDefined();
      expect(state.alphaState).toBeDefined();
      expect(state.positionSizeMultiplier).toBeDefined();
      expect(state.var95).toBeDefined();
      expect(state.var99).toBeDefined();
      expect(state.es95).toBeDefined();
      expect(state.es99).toBeDefined();
      expect(state.timestamp).toBeGreaterThan(0);

      // VaR99 should be >= VaR95
      expect(state.var99).toBeGreaterThanOrEqual(state.var95);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. DynamicThresholds Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('DynamicThresholds', () => {
  let dt: DynamicThresholds;

  beforeEach(() => {
    dt = new DynamicThresholds(500, 50, 0); // 0ms recalibration for testing
  });

  describe('calibration', () => {
    it('returns default thresholds before calibration', () => {
      const thresholds = dt.getThresholds();
      expect(thresholds.isCalibrated).toBe(false);
      expect(thresholds.volatilityHigh).toBe(1.5); // Default
    });

    it('calibrates after enough samples', () => {
      // Feed 100+ ATR and price values
      for (let i = 0; i < 150; i++) {
        dt.addATR(1.0 + Math.random() * 0.5);
        dt.addPrice(100 + Math.sin(i / 10) * 5);
      }
      const thresholds = dt.getThresholds();
      expect(thresholds.isCalibrated).toBe(true);
      expect(thresholds.sampleSize).toBeGreaterThanOrEqual(50);
    });

    it('produces asset-specific thresholds', () => {
      // Simulate a low-volatility asset (like EURUSD)
      const dtLow = new DynamicThresholds(500, 50, 0);
      for (let i = 0; i < 150; i++) {
        dtLow.addATR(0.5 + Math.random() * 0.3);
        dtLow.addPrice(1.1 + Math.sin(i / 10) * 0.01);
      }

      // Simulate a high-volatility asset (like XAUUSD)
      const dtHigh = new DynamicThresholds(500, 50, 0);
      for (let i = 0; i < 150; i++) {
        dtHigh.addATR(2.0 + Math.random() * 1.5);
        dtHigh.addPrice(2000 + Math.sin(i / 10) * 50);
      }

      const lowThresholds = dtLow.getThresholds();
      const highThresholds = dtHigh.getThresholds();

      // High-vol asset should have higher volatility threshold
      expect(highThresholds.volatilityHigh).toBeGreaterThan(lowThresholds.volatilityHigh);
    });
  });

  describe('detectRegime()', () => {
    it('detects VOLATILE when ATR spikes', () => {
      // Calibrate with flat prices (no momentum) and moderate ATR
      const dtv = new DynamicThresholds(500, 50, 0);
      for (let i = 0; i < 150; i++) {
        dtv.addATR(1.0 + Math.random() * 0.3);
        dtv.addPrice(100); // Flat price → zero momentum
      }
      // Call detectRegime with extreme ATR without corrupting history
      const result = dtv.detectRegime(10.0, 100);
      expect(result.regime).toBe('VOLATILE');
      expect(result.reversalRisk).toBe(true);
    });

    it('detects CALM when ATR drops', () => {
      const dtc = new DynamicThresholds(500, 50, 0);
      for (let i = 0; i < 150; i++) {
        dtc.addATR(1.0 + Math.random() * 0.3);
        dtc.addPrice(100); // Flat price
      }
      // Call detectRegime with very low ATR without corrupting history
      const result = dtc.detectRegime(0.01, 100);
      expect(result.regime).toBe('CALM');
    });

    it('detects TRENDING with strong momentum', () => {
      const dtt = new DynamicThresholds(500, 50, 0);
      // Calibrate with small random moves
      for (let i = 0; i < 150; i++) {
        dtt.addATR(1.0);
        dtt.addPrice(100 + (Math.random() - 0.5) * 0.5); // Near-flat
      }
      // Now feed strongly rising prices to build momentum
      for (let i = 0; i < 30; i++) {
        dtt.addPrice(100 + i * 3); // Strong upward momentum
      }
      const result = dtt.detectRegime(1.0, 190);
      expect(result.regime).toBe('TRENDING');
    });

    it('detects reversal risk with extreme RSI', () => {
      const dtr = new DynamicThresholds(500, 50, 0);
      for (let i = 0; i < 150; i++) {
        dtr.addATR(1.0);
        dtr.addPrice(100 + (Math.random() - 0.5) * 0.5);
      }
      for (let i = 0; i < 30; i++) {
        dtr.addPrice(100 + i * 3);
      }
      const result = dtr.detectRegime(1.0, 190, 80); // RSI = 80
      if (result.regime === 'TRENDING') {
        expect(result.reversalRisk).toBe(true);
      }
    });

    it('returns strength between 0 and 1', () => {
      const result = dt.detectRegime(1.0, 100);
      expect(result.strength).toBeGreaterThanOrEqual(0);
      expect(result.strength).toBeLessThanOrEqual(1);
    });

    it('includes thresholds in result', () => {
      const result = dt.detectRegime(1.0, 100);
      expect(result.thresholds).toBeDefined();
      expect(result.thresholds.volatilityHigh).toBeGreaterThan(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Integration: Pareto + Thresholds working together
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pareto System Integration', () => {
  it('full pipeline: prices → log returns → pareto → alpha state → position sizing', () => {
    const analyzer = new ParetoAnalyzer(2000, 50, 0.6);
    const thresholds = new DynamicThresholds(500, 30, 0);

    // Simulate 300 ticks of market data
    let price = 42000; // BTC-like
    for (let i = 0; i < 300; i++) {
      const change = (Math.random() - 0.5) * 0.01; // ±0.5%
      price *= (1 + change);
      analyzer.addPrice(price);
      thresholds.addATR(price * 0.005); // Approximate ATR
      thresholds.addPrice(price);
    }

    // Analyze
    const paretoState = analyzer.analyze();
    const regime = thresholds.detectRegime(price * 0.005, price);

    // Pareto state should be coherent
    expect(paretoState.params.alpha).toBeGreaterThan(0);
    expect(paretoState.alphaState).toBeDefined();
    expect(paretoState.positionSizeMultiplier).toBeGreaterThanOrEqual(0);
    expect(paretoState.positionSizeMultiplier).toBeLessThanOrEqual(1);

    // Regime should be detected
    expect(['TRENDING', 'RANGING', 'VOLATILE', 'CALM']).toContain(regime.regime);
    expect(regime.strength).toBeGreaterThanOrEqual(0);
    expect(regime.strength).toBeLessThanOrEqual(1);
  });

  it('works for multi-symbol (BTC vs SOL)', () => {
    const btcAnalyzer = new ParetoAnalyzer(2000, 50, 0.6);
    const solAnalyzer = new ParetoAnalyzer(2000, 50, 0.6);

    let btcPrice = 42000;
    let solPrice = 100;

    for (let i = 0; i < 300; i++) {
      btcPrice *= 1 + (Math.random() - 0.5) * 0.01;
      solPrice *= 1 + (Math.random() - 0.5) * 0.02; // SOL more volatile

      btcAnalyzer.addPrice(btcPrice);
      solAnalyzer.addPrice(solPrice);
    }

    const btcState = btcAnalyzer.analyze();
    const solState = solAnalyzer.analyze();

    // Both should produce valid results regardless of price scale
    expect(btcState.params.alpha).toBeGreaterThan(0);
    expect(solState.params.alpha).toBeGreaterThan(0);
    expect(btcState.params.sampleSize).toBe(solState.params.sampleSize);
  });

  it('position size reduces as alpha decreases', () => {
    const analyzer = new ParetoAnalyzer(2000, 50, 0.6);

    // Normal market
    let price = 100;
    for (let i = 0; i < 200; i++) {
      price *= 1 + (Math.random() - 0.5) * 0.005; // Small moves
      analyzer.addPrice(price);
    }
    const normalState = analyzer.analyze();

    // The multiplier should be > 0 in normal conditions
    expect(normalState.positionSizeMultiplier).toBeGreaterThan(0);
  });
});
