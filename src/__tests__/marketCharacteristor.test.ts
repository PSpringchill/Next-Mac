import { describe, it, expect, beforeEach } from 'vitest';
import MarketCharacteristor, {
  FlightPhase,
  TurbulenceCategory,
  TrafficDensity,
  Visibility,
  SquawkCode,
  FIB_LEVELS,
  FIB_EXTENSIONS,
} from '../app/components/TradingEngine/MarketCharacteristor';
import type { SymbolInput, Candle15m } from '../app/components/TradingEngine/MarketCharacteristor';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCandle(high: number, low: number, close?: number): Candle15m {
  return {
    high,
    low,
    open: low + (high - low) * 0.3,
    close: close ?? low + (high - low) * 0.6,
    volume: 1000,
    timestamp: Date.now(),
  };
}

function makeInput(overrides: Partial<SymbolInput> = {}): SymbolInput {
  return {
    symbol: 'BTCUSD',
    price: 42000,
    candle15m: makeCandle(42500, 41500),
    atr: 400,
    atrPercentile: 0.5,
    volumePercentile: 0.5,
    stdDev: 1.5,
    prevStdDev: 1.2,
    momentum: 0.5,
    macdDivergence: false,
    rsiDivergence: false,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MarketCharacteristor', () => {
  let mc: MarketCharacteristor;

  beforeEach(() => {
    mc = new MarketCharacteristor();
  });

  // ─── Fibonacci Levels ───────────────────────────────────────────────────

  describe('calculateFibLevels()', () => {
    it('calculates correct Fib levels for BTC range', () => {
      const fibs = mc.calculateFibLevels(41500, 1000);
      expect(fibs.length).toBe(7);
      expect(fibs[0].price).toBe(41500);        // Fib 0 = floor
      expect(fibs[6].price).toBe(42500);        // Fib 1000 = ceiling
      expect(fibs[3].price).toBe(42000);        // Fib 500 = midpoint
      expect(fibs[4].price).toBeCloseTo(42118); // Fib 618
    });

    it('calculates correct Fib levels for SOL range', () => {
      const fibs = mc.calculateFibLevels(99, 3);
      expect(fibs[0].price).toBe(99);
      expect(fibs[6].price).toBe(102);
      expect(fibs[4].price).toBeCloseTo(100.854); // Fib 618
    });

    it('produces same ratios for any symbol', () => {
      const btcFibs = mc.calculateFibLevels(41500, 1000);
      const solFibs = mc.calculateFibLevels(99, 3);
      for (let i = 0; i < btcFibs.length; i++) {
        expect(btcFibs[i].ratio).toBe(solFibs[i].ratio);
      }
    });
  });

  describe('calculateFibExtensions()', () => {
    it('calculates extension levels', () => {
      const exts = mc.calculateFibExtensions(41500, 1000);
      expect(exts.length).toBe(4);
      const ext1272 = exts.find(e => e.name === 'EXT_1272');
      expect(ext1272).toBeDefined();
      expect(ext1272!.price).toBeCloseTo(42772);
    });

    it('calculates negative extensions for breakdowns', () => {
      const exts = mc.calculateFibExtensions(41500, 1000);
      const extNeg = exts.find(e => e.name === 'EXT_NEG_272');
      expect(extNeg).toBeDefined();
      expect(extNeg!.price).toBeCloseTo(41228);
    });
  });

  // ─── Turbulence Classification ──────────────────────────────────────────

  describe('classifyTurbulence()', () => {
    it('returns SMOOTH for low ATR/Range', () => {
      expect(mc.classifyTurbulence(0.1, 0.1)).toBe(TurbulenceCategory.SMOOTH);
    });

    it('returns LIGHT for moderate ATR/Range', () => {
      expect(mc.classifyTurbulence(0.2, 0.2)).toBe(TurbulenceCategory.LIGHT);
    });

    it('returns MODERATE for active ATR/Range', () => {
      expect(mc.classifyTurbulence(0.4, 0.5)).toBe(TurbulenceCategory.MODERATE);
    });

    it('returns SEVERE for high ATR/Range', () => {
      expect(mc.classifyTurbulence(0.7, 0.75)).toBe(TurbulenceCategory.SEVERE);
    });

    it('returns EXTREME for ATR exceeding range', () => {
      expect(mc.classifyTurbulence(1.2, 0.95)).toBe(TurbulenceCategory.EXTREME);
    });

    it('uses percentile as secondary confirmation', () => {
      // Low ratio but very high percentile
      expect(mc.classifyTurbulence(0.1, 0.95)).toBe(TurbulenceCategory.EXTREME);
    });
  });

  // ─── Traffic Classification ─────────────────────────────────────────────

  describe('classifyTraffic()', () => {
    it('returns VACANT for very low volume', () => {
      expect(mc.classifyTraffic(0.05)).toBe(TrafficDensity.VACANT);
    });

    it('returns MODERATE for mid volume', () => {
      expect(mc.classifyTraffic(0.45)).toBe(TrafficDensity.MODERATE);
    });

    it('returns HEAVY for high volume', () => {
      expect(mc.classifyTraffic(0.75)).toBe(TrafficDensity.HEAVY);
    });

    it('returns EMERGENCY for extreme volume', () => {
      expect(mc.classifyTraffic(0.97)).toBe(TrafficDensity.EMERGENCY);
    });
  });

  // ─── Visibility Classification ──────────────────────────────────────────

  describe('classifyVisibility()', () => {
    it('returns VMC when StdDev expanding', () => {
      expect(mc.classifyVisibility(1.5, 1.2)).toBe(Visibility.VMC);
    });

    it('returns IMC when StdDev contracting', () => {
      expect(mc.classifyVisibility(1.0, 1.5)).toBe(Visibility.IMC);
    });

    it('returns MARGINAL when StdDev flat', () => {
      expect(mc.classifyVisibility(1.0, 1.0)).toBe(Visibility.MARGINAL);
    });
  });

  // ─── Squawk Codes ───────────────────────────────────────────────────────

  describe('determineSquawk()', () => {
    it('returns NORMAL for standard conditions', () => {
      expect(mc.determineSquawk(TurbulenceCategory.MODERATE, TrafficDensity.HEAVY, false))
        .toBe(SquawkCode.NORMAL);
    });

    it('returns MAYDAY for extreme turbulence', () => {
      expect(mc.determineSquawk(TurbulenceCategory.EXTREME, TrafficDensity.HEAVY, false))
        .toBe(SquawkCode.MAYDAY);
    });

    it('returns MAYDAY for extreme + emergency', () => {
      expect(mc.determineSquawk(TurbulenceCategory.EXTREME, TrafficDensity.EMERGENCY, false))
        .toBe(SquawkCode.MAYDAY);
    });

    it('returns COMM_FAIL for divergence', () => {
      expect(mc.determineSquawk(TurbulenceCategory.LIGHT, TrafficDensity.MODERATE, true))
        .toBe(SquawkCode.COMM_FAIL);
    });
  });

  // ─── Flight Phase Classification ────────────────────────────────────────

  describe('classifyFlightPhase()', () => {
    it('returns TAKEOFF when price above ceiling', () => {
      expect(mc.classifyFlightPhase(1.05, TurbulenceCategory.LIGHT, TrafficDensity.HEAVY, 1.0))
        .toBe(FlightPhase.TAKEOFF);
    });

    it('returns CLIMB for upper range with positive momentum', () => {
      expect(mc.classifyFlightPhase(0.75, TurbulenceCategory.LIGHT, TrafficDensity.MODERATE, 0.5))
        .toBe(FlightPhase.CLIMB);
    });

    it('returns DESCENT for lower range with negative momentum', () => {
      expect(mc.classifyFlightPhase(0.2, TurbulenceCategory.LIGHT, TrafficDensity.MODERATE, -0.5))
        .toBe(FlightPhase.DESCENT);
    });

    it('returns HOLDING at midrange with low momentum', () => {
      expect(mc.classifyFlightPhase(0.5, TurbulenceCategory.LIGHT, TrafficDensity.MODERATE, 0.01))
        .toBe(FlightPhase.HOLDING);
    });

    it('returns TURBULENCE on severe conditions', () => {
      expect(mc.classifyFlightPhase(0.5, TurbulenceCategory.SEVERE, TrafficDensity.MODERATE, 0.0))
        .toBe(FlightPhase.TURBULENCE);
    });

    it('returns MAYDAY on extreme + congested', () => {
      expect(mc.classifyFlightPhase(0.5, TurbulenceCategory.EXTREME, TrafficDensity.CONGESTED, 0.0))
        .toBe(FlightPhase.MAYDAY);
    });

    it('returns LANDING when price below floor', () => {
      expect(mc.classifyFlightPhase(-0.05, TurbulenceCategory.LIGHT, TrafficDensity.MODERATE, -0.5))
        .toBe(FlightPhase.LANDING);
    });
  });

  // ─── TP/SL Calculation ──────────────────────────────────────────────────

  describe('calculateTPSL()', () => {
    const fibs = new MarketCharacteristor().calculateFibLevels(41500, 1000);
    const exts = new MarketCharacteristor().calculateFibExtensions(41500, 1000);

    it('sets TP at Fib Ext 127.2% for TAKEOFF', () => {
      const { tp, sl } = mc.calculateTPSL(FlightPhase.TAKEOFF, fibs, exts, 1.05);
      expect(tp).toBeDefined();
      expect(tp!.name).toBe('EXT_1272');
      expect(tp!.price).toBeCloseTo(42772);
    });

    it('sets TP at Fib 786 for CLIMB', () => {
      const { tp, sl } = mc.calculateTPSL(FlightPhase.CLIMB, fibs, exts, 0.7);
      expect(tp).toBeDefined();
      expect(tp!.ratio).toBe(0.786);
    });

    it('sets null TP/SL for MAYDAY', () => {
      const { tp, sl } = mc.calculateTPSL(FlightPhase.MAYDAY, fibs, exts, 0.5);
      expect(tp).toBeNull();
      expect(sl).toBeNull();
    });

    it('uses wider levels for TURBULENCE', () => {
      const { tp, sl } = mc.calculateTPSL(FlightPhase.TURBULENCE, fibs, exts, 0.7);
      // Upper position => TP at ceiling, SL at floor
      expect(tp!.ratio).toBe(1.0);
      expect(sl!.ratio).toBe(0);
    });
  });

  // ─── Position Sizing ────────────────────────────────────────────────────

  describe('calculatePositionSize()', () => {
    it('returns 0 for MAYDAY squawk', () => {
      expect(mc.calculatePositionSize(TurbulenceCategory.EXTREME, TrafficDensity.EMERGENCY, SquawkCode.MAYDAY))
        .toBe(0);
    });

    it('returns 1% for COMM_FAIL squawk', () => {
      expect(mc.calculatePositionSize(TurbulenceCategory.LIGHT, TrafficDensity.MODERATE, SquawkCode.COMM_FAIL))
        .toBe(1);
    });

    it('returns ~2% for normal conditions', () => {
      const size = mc.calculatePositionSize(TurbulenceCategory.LIGHT, TrafficDensity.MODERATE, SquawkCode.NORMAL);
      expect(size).toBeGreaterThan(1);
      expect(size).toBeLessThanOrEqual(3);
    });

    it('reduces size for severe turbulence', () => {
      const normal = mc.calculatePositionSize(TurbulenceCategory.LIGHT, TrafficDensity.MODERATE, SquawkCode.NORMAL);
      const severe = mc.calculatePositionSize(TurbulenceCategory.SEVERE, TrafficDensity.MODERATE, SquawkCode.NORMAL);
      expect(severe).toBeLessThan(normal);
    });

    it('increases size for heavy traffic (conviction)', () => {
      const mod = mc.calculatePositionSize(TurbulenceCategory.LIGHT, TrafficDensity.MODERATE, SquawkCode.NORMAL);
      const heavy = mc.calculatePositionSize(TurbulenceCategory.LIGHT, TrafficDensity.HEAVY, SquawkCode.NORMAL);
      expect(heavy).toBeGreaterThan(mod);
    });
  });

  // ─── Action Determination ───────────────────────────────────────────────

  describe('determineAction()', () => {
    it('returns LONG for CLIMB', () => {
      expect(mc.determineAction(FlightPhase.CLIMB, SquawkCode.NORMAL)).toBe('LONG');
    });

    it('returns SHORT for DESCENT', () => {
      expect(mc.determineAction(FlightPhase.DESCENT, SquawkCode.NORMAL)).toBe('SHORT');
    });

    it('returns GRID for HOLDING', () => {
      expect(mc.determineAction(FlightPhase.HOLDING, SquawkCode.NORMAL)).toBe('GRID');
    });

    it('returns EXIT for MAYDAY squawk', () => {
      expect(mc.determineAction(FlightPhase.CLIMB, SquawkCode.MAYDAY)).toBe('EXIT');
    });

    it('returns HOLD for COMM_FAIL squawk', () => {
      expect(mc.determineAction(FlightPhase.CLIMB, SquawkCode.COMM_FAIL)).toBe('HOLD');
    });
  });

  // ─── Full ATIS Report ───────────────────────────────────────────────────

  describe('generateATIS()', () => {
    it('generates a complete ATIS for BTC', () => {
      const atis = mc.generateATIS(makeInput());
      expect(atis.symbol).toBe('BTCUSD');
      expect(atis.ceiling).toBe(42500);
      expect(atis.floor).toBe(41500);
      expect(atis.airspace).toBe(1000);
      expect(atis.fibLevels.length).toBe(7);
      expect(atis.fibExtensions.length).toBe(4);
      expect(atis.metar).toContain('METAR BTCUSD');
      expect(atis.metar).toContain('FL');
    });

    it('generates correct ATIS for SOL (multi-symbol scaling)', () => {
      const atis = mc.generateATIS(makeInput({
        symbol: 'SOLUSDT',
        price: 100.5,
        candle15m: makeCandle(102, 99),
        atr: 1.2,
        atrPercentile: 0.5,
        momentum: -0.3,
      }));
      expect(atis.symbol).toBe('SOLUSDT');
      expect(atis.ceiling).toBe(102);
      expect(atis.floor).toBe(99);
      expect(atis.airspace).toBe(3);
      // Fib 618 should be at 99 + 3 * 0.618 = 100.854
      const fib618 = atis.fibLevels.find(f => f.ratio === 0.618);
      expect(fib618!.price).toBeCloseTo(100.854);
    });

    it('detects MAYDAY for extreme conditions', () => {
      const atis = mc.generateATIS(makeInput({
        atr: 1500,
        atrPercentile: 0.96,
        volumePercentile: 0.97,
      }));
      expect(atis.flightPhase).toBe(FlightPhase.MAYDAY);
      expect(atis.squawk).toBe(SquawkCode.MAYDAY);
      expect(atis.action).toBe('EXIT');
      expect(atis.positionSizePct).toBe(0);
    });

    it('detects windshear from divergence', () => {
      const atis = mc.generateATIS(makeInput({ macdDivergence: true }));
      expect(atis.windshear).toBe(true);
      expect(atis.squawk).toBe(SquawkCode.COMM_FAIL);
    });
  });

  // ─── METAR String ───────────────────────────────────────────────────────

  describe('generateMETAR()', () => {
    it('produces a parseable METAR string', () => {
      const atis = mc.generateATIS(makeInput());
      const parts = atis.metar.split(' ');
      expect(parts[0]).toBe('METAR');
      expect(parts[1]).toBe('BTCUSD');
      // Zulu time
      expect(parts[2]).toMatch(/^\d{6}Z$/);
      // Contains key fields
      expect(atis.metar).toContain('TURB-');
      expect(atis.metar).toContain('TFC-');
      expect(atis.metar).toContain('VIS-');
      expect(atis.metar).toContain('SQ');
    });
  });

  // ─── Multi-Symbol Dashboard ─────────────────────────────────────────────

  describe('generateDashboard()', () => {
    it('generates ATIS for multiple symbols', () => {
      const dashboard = mc.generateDashboard([
        makeInput({ symbol: 'BTCUSD', price: 42000, candle15m: makeCandle(42500, 41500) }),
        makeInput({ symbol: 'SOLUSDT', price: 100, candle15m: makeCandle(102, 99), atr: 1.2 }),
        makeInput({ symbol: 'ETHUSD', price: 3200, candle15m: makeCandle(3250, 3180), atr: 25 }),
      ]);
      expect(dashboard.length).toBe(3);
      expect(dashboard[0].symbol).toBe('BTCUSD');
      expect(dashboard[1].symbol).toBe('SOLUSDT');
      expect(dashboard[2].symbol).toBe('ETHUSD');
      // All use same Fib ratios
      for (const atis of dashboard) {
        expect(atis.fibLevels.map(f => f.ratio)).toEqual([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);
      }
    });
  });
});
