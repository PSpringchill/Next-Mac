import { describe, it, expect, beforeEach } from 'vitest';
import MarketStateDetector, {
  MarketPhase,
  SubPhase,
  TradeMode,
  MARKET_STATE_CONFIG,
} from '../app/components/TradingEngine/MarketStateConfig';
import type { IndicatorValues } from '../app/components/TradingEngine/MarketStateConfig';

// ─── Indicator Presets ───────────────────────────────────────────────────────

const BASE_INDICATORS: IndicatorValues = {
  price: 100,
  ma50: 98,
  ma200: 95,
  macdLine: 0.5,
  macdSignal: 0.3,
  macdHistogram: 0.2,
  prevMacdHistogram: 0.15,
  rsi: 55,
  atr: 2,
  atrPercentile: 0.5,
  fisherTransform: 0.5,
  prevFisherTransform: 0.3,
  stdDev: 1.5,
  prevStdDev: 1.2,
  bollingerWidth: 4,
  prevBollingerWidth: 4.5,
  volume: 1000,
  prevVolume: 900,
};

function makeIndicators(overrides: Partial<IndicatorValues>): IndicatorValues {
  return { ...BASE_INDICATORS, ...overrides };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MarketStateConfig', () => {
  describe('MARKET_STATE_CONFIG', () => {
    it('has 8 state definitions', () => {
      expect(MARKET_STATE_CONFIG.length).toBe(8);
    });

    it('all states have unique phases', () => {
      const phases = MARKET_STATE_CONFIG.map(s => s.phase);
      expect(new Set(phases).size).toBe(8);
    });

    it('all states have valid trade settings', () => {
      for (const config of MARKET_STATE_CONFIG) {
        expect(config.tradeSettings.positionSizePct).toBeGreaterThan(0);
        expect(config.tradeSettings.maxConcurrentTrades).toBeGreaterThan(0);
        expect(config.tradeSettings.riskMultiplier).toBeGreaterThan(0);
        expect(config.tradeSettings.mode).toBeTruthy();
      }
    });

    it('all states have valid regime mappings', () => {
      for (const config of MARKET_STATE_CONFIG) {
        expect(config.regimeMapping.name).toBeTruthy();
        expect(typeof config.regimeMapping.volatility).toBe('number');
        expect(typeof config.regimeMapping.momentum).toBe('number');
      }
    });

    it('priorities are within valid range', () => {
      for (const config of MARKET_STATE_CONFIG) {
        expect(config.priority).toBeGreaterThanOrEqual(1);
        expect(config.priority).toBeLessThanOrEqual(10);
      }
    });

    it('high volatility has highest priority', () => {
      const highVol = MARKET_STATE_CONFIG.find(c => c.phase === MarketPhase.HIGH_VOLATILITY);
      const maxPriority = Math.max(...MARKET_STATE_CONFIG.map(c => c.priority));
      expect(highVol?.priority).toBe(maxPriority);
    });

    it('grid configs exist for grid_neutral modes', () => {
      const gridStates = MARKET_STATE_CONFIG.filter(c => c.tradeSettings.mode === TradeMode.GRID_NEUTRAL);
      expect(gridStates.length).toBeGreaterThan(0);
      for (const state of gridStates) {
        expect(state.tradeSettings.gridConfig).toBeDefined();
        expect(state.tradeSettings.gridConfig!.gridCount).toBeGreaterThan(0);
        expect(state.tradeSettings.gridConfig!.profitPerGridPct).toBeGreaterThan(0);
      }
    });
  });
});

describe('MarketStateDetector', () => {
  let detector: MarketStateDetector;

  beforeEach(() => {
    detector = new MarketStateDetector();
  });

  describe('detect()', () => {
    it('returns a valid DetectedState', () => {
      const state = detector.detect(BASE_INDICATORS);
      expect(state.phase).toBeTruthy();
      expect(state.confidence).toBeGreaterThanOrEqual(0);
      expect(state.confidence).toBeLessThanOrEqual(1);
      expect(state.tradeSettings).toBeDefined();
      expect(state.regime).toBeDefined();
    });

    it('detects uptrend with strong bullish indicators', () => {
      const ind = makeIndicators({
        price: 110,
        ma50: 105,
        ma200: 95,
        macdLine: 1.0,
        macdSignal: 0.5,
        macdHistogram: 0.5,
        prevMacdHistogram: 0.3,
        rsi: 65,
        atrPercentile: 0.7,
        fisherTransform: 1.0,
        prevFisherTransform: 0.5,
        stdDev: 2.0,
        prevStdDev: 1.5,
      });
      const state = detector.detect(ind);
      expect(state.phase).toBe(MarketPhase.UPTREND);
      expect(state.tradeSettings.direction).toBe('long');
    });

    it('detects downtrend with bearish indicators', () => {
      const ind = makeIndicators({
        price: 85,
        ma50: 90,
        ma200: 100,
        macdLine: -1.0,
        macdSignal: -0.5,
        macdHistogram: -0.5,
        prevMacdHistogram: -0.3,
        rsi: 35,
        atrPercentile: 0.7,
        fisherTransform: -1.0,
        prevFisherTransform: -0.5,
        stdDev: 2.0,
        prevStdDev: 1.5,
      });
      const state = detector.detect(ind);
      expect(state.phase).toBe(MarketPhase.DOWNTREND);
      expect(state.tradeSettings.direction).toBe('short');
    });

    it('detects range-bound with neutral indicators', () => {
      const ind = makeIndicators({
        price: 100,
        ma50: 100,
        ma200: 100,
        macdLine: 0.001,
        macdSignal: 0.0005,
        macdHistogram: 0.0005,
        prevMacdHistogram: 0.0004,
        rsi: 50,
        atrPercentile: 0.3,
        fisherTransform: 0.01,
        prevFisherTransform: 0.01,
        stdDev: 0.5,
        prevStdDev: 0.6,
      });
      const state = detector.detect(ind);
      expect(state.phase).toBe(MarketPhase.RANGE_BOUND);
      expect(state.tradeSettings.mode).toBe(TradeMode.GRID_NEUTRAL);
    });

    it('detects high volatility with extreme ATR', () => {
      const ind = makeIndicators({
        atrPercentile: 0.95,
        stdDev: 5.0,
        prevStdDev: 3.0,
        rsi: 50,
        macdHistogram: 1.0,
        prevMacdHistogram: 0.5,
      });
      const state = detector.detect(ind);
      expect(state.phase).toBe(MarketPhase.HIGH_VOLATILITY);
      expect(state.tradeSettings.riskMultiplier).toBeLessThanOrEqual(0.5);
    });

    it('detects low volatility with Bollinger squeeze', () => {
      const ind = makeIndicators({
        price: 100,
        ma50: 100,
        ma200: 101,            // Price NOT above MA200 — avoids pullback match
        atrPercentile: 0.1,
        stdDev: 0.3,
        prevStdDev: 0.4,       // StdDev contracting
        bollingerWidth: 1.0,
        prevBollingerWidth: 1.5, // Bollinger squeezing
        macdHistogram: 0.0001,
        prevMacdHistogram: 0.0001,
        macdLine: 0.0001,
        macdSignal: 0.0001,
        rsi: 50,
        fisherTransform: 0.01,
        prevFisherTransform: 0.01,
      });
      const state = detector.detect(ind);
      expect(state.phase).toBe(MarketPhase.LOW_VOLATILITY);
      expect(state.tradeSettings.mode).toBe(TradeMode.HOLD);
    });
  });

  describe('sub-phase detection', () => {
    it('detects overbought when RSI > 70', () => {
      const ind = makeIndicators({ rsi: 78 });
      const state = detector.detect(ind);
      expect(state.subPhase).toBe(SubPhase.OVERBOUGHT);
    });

    it('detects oversold when RSI < 30', () => {
      const ind = makeIndicators({ rsi: 22 });
      const state = detector.detect(ind);
      expect(state.subPhase).toBe(SubPhase.OVERSOLD);
    });

    it('detects accumulation in low vol with stable price and rising volume', () => {
      const ind = makeIndicators({
        atrPercentile: 0.1,
        rsi: 45,
        volume: 1200,
        prevVolume: 1000,
      });
      const state = detector.detect(ind);
      expect(state.subPhase).toBe(SubPhase.ACCUMULATION);
    });

    it('returns NONE for normal conditions', () => {
      const ind = makeIndicators({ rsi: 55, atrPercentile: 0.5 });
      const state = detector.detect(ind);
      expect(state.subPhase).toBe(SubPhase.NONE);
    });
  });

  describe('trade settings adjustment', () => {
    it('reduces risk multiplier in overbought', () => {
      const ind = makeIndicators({ rsi: 75 });
      const state = detector.detect(ind);
      // Overbought should halve risk
      expect(state.tradeSettings.riskMultiplier).toBeLessThan(1.0);
    });

    it('applies ATR-based TP confirmed by StdDev for trend states', () => {
      const ind = makeIndicators({
        price: 110,
        ma50: 105,
        ma200: 95,
        macdLine: 1.0,
        macdSignal: 0.5,
        macdHistogram: 0.5,
        prevMacdHistogram: 0.3,
        rsi: 65,
        atr: 3,
        atrPercentile: 0.7,
        fisherTransform: 1.0,
        prevFisherTransform: 0.5,
        stdDev: 2.0,
        prevStdDev: 1.5,  // StdDev expanding → full ATR TP
      });
      const state = detector.detect(ind);
      if (state.tradeSettings.takeProfitType === 'atr_multiplier') {
        // TP = (ATR / price) * multiplier, confirmed by StdDev
        expect(state.tradeSettings.takeProfitValue).toBeGreaterThan(0);
      }
    });

    it('reduces ATR-based TP when StdDev is contracting', () => {
      const ind = makeIndicators({
        price: 110,
        ma50: 105,
        ma200: 95,
        macdLine: 1.0,
        macdSignal: 0.5,
        macdHistogram: 0.5,
        prevMacdHistogram: 0.3,
        rsi: 65,
        atr: 3,
        atrPercentile: 0.7,
        fisherTransform: 1.0,
        prevFisherTransform: 0.5,
        stdDev: 1.0,
        prevStdDev: 2.0,  // StdDev contracting → reduced TP
      });
      const state = detector.detect(ind);
      if (state.tradeSettings.takeProfitType === 'atr_multiplier') {
        // Should be 70% of full ATR-based TP
        const fullTP = (3 / 110) * 2;
        expect(state.tradeSettings.takeProfitValue).toBeCloseTo(fullTP * 0.7, 4);
      }
    });
  });

  describe('state history', () => {
    it('starts with empty history', () => {
      expect(detector.getStateHistory().length).toBe(0);
      expect(detector.getCurrentPhase()).toBeNull();
    });

    it('accumulates history', () => {
      detector.detect(BASE_INDICATORS);
      detector.detect(BASE_INDICATORS);
      expect(detector.getStateHistory().length).toBe(2);
    });

    it('getCurrentPhase returns last detected phase', () => {
      detector.detect(BASE_INDICATORS);
      expect(detector.getCurrentPhase()).not.toBeNull();
    });

    it('detects transitions between states', () => {
      // First: uptrend
      detector.detect(makeIndicators({
        price: 110, ma50: 105, ma200: 95,
        macdLine: 1.0, macdSignal: 0.5, macdHistogram: 0.5, prevMacdHistogram: 0.3,
        rsi: 65, atrPercentile: 0.7,
        fisherTransform: 1.0, prevFisherTransform: 0.5, stdDev: 2.0, prevStdDev: 1.5,
      }));

      // Then: high vol
      const state = detector.detect(makeIndicators({
        atrPercentile: 0.95, stdDev: 5.0, prevStdDev: 3.0,
        rsi: 50, macdHistogram: 1.0, prevMacdHistogram: 0.5,
      }));

      expect(state.regime.isTransition).toBe(true);
    });
  });

  describe('active indicators', () => {
    it('reports which indicators match', () => {
      const state = detector.detect(makeIndicators({
        price: 110, ma50: 105, ma200: 95,
        rsi: 65,
      }));
      expect(state.activeIndicators.length).toBeGreaterThan(0);
    });
  });
});
