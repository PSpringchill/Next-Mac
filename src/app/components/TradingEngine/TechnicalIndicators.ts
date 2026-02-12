// ─── Technical Indicators (TradingView-Accurate) ─────────────────────────────
// Powered by the `technicalindicators` library — same calculations as TradingView.
// Provides RSI, MACD, ATR, Bollinger Bands, Stochastic, ADX via streaming API.

import {
  RSI as TVRsi,
  MACD as TVMacd,
  ATR as TVAtr,
  BollingerBands as TVBB,
  Stochastic as TVStoch,
  ADX as TVAdx,
} from 'technicalindicators';

// ─── State Interfaces ────────────────────────────────────────────────────────

export interface RSIState {
  value: number;          // RSI [0, 100]
  isOverbought: boolean;  // > 70
  isOversold: boolean;    // < 30
  inRange: boolean;       // 30 < RSI < 70
}

export interface MACDState {
  macdLine: number;       // Fast EMA - Slow EMA
  signalLine: number;     // EMA of MACD line
  histogram: number;      // MACD - Signal
  bullishCrossover: boolean;
  bearishCrossover: boolean;
  aligned: 'bullish' | 'bearish' | 'neutral';
}

export interface ATRState {
  value: number;          // Current ATR
  percentile: number;     // Where ATR sits relative to history [0, 1]
  isExtreme: boolean;     // ATR > 90th percentile
  isNormal: boolean;      // 10th < ATR < 90th percentile
}

export interface BollingerBandsState {
  upper: number;          // Upper band (SMA + stdDev * k)
  middle: number;         // Middle band (SMA)
  lower: number;          // Lower band (SMA - stdDev * k)
  bandwidth: number;      // (upper - lower) / middle — volatility measure
  percentB: number;       // (price - lower) / (upper - lower) — position within bands
  squeeze: boolean;       // bandwidth < 0.02 — low volatility compression
}

export interface StochasticState {
  k: number;              // %K (fast stochastic)
  d: number;              // %D (signal line)
  isOverbought: boolean;  // K > 80
  isOversold: boolean;    // K < 20
  bullishCrossover: boolean; // K crosses above D from oversold zone
  bearishCrossover: boolean; // K crosses below D from overbought zone
}

export interface ADXState {
  adx: number;            // ADX value [0, 100]
  pdi: number;            // +DI (positive directional indicator)
  mdi: number;            // -DI (negative directional indicator)
  isTrending: boolean;    // ADX > 25
  isStrong: boolean;      // ADX > 40
  bullishDI: boolean;     // +DI > -DI
}

export interface TechnicalState {
  rsi: RSIState;
  macd: MACDState;
  atr: ATRState;
  bollingerBands: BollingerBandsState;
  stochastic: StochasticState;
  adx: ADXState;
}

// ─── Default (empty) states for warmup period ────────────────────────────────

const DEFAULT_RSI: RSIState = { value: 50, isOverbought: false, isOversold: false, inRange: true };
const DEFAULT_MACD: MACDState = { macdLine: 0, signalLine: 0, histogram: 0, bullishCrossover: false, bearishCrossover: false, aligned: 'neutral' };
const DEFAULT_ATR: ATRState = { value: 0, percentile: 0.5, isExtreme: false, isNormal: true };
const DEFAULT_BB: BollingerBandsState = { upper: 0, middle: 0, lower: 0, bandwidth: 0, percentB: 0.5, squeeze: false };
const DEFAULT_STOCH: StochasticState = { k: 50, d: 50, isOverbought: false, isOversold: false, bullishCrossover: false, bearishCrossover: false };
const DEFAULT_ADX: ADXState = { adx: 0, pdi: 0, mdi: 0, isTrending: false, isStrong: false, bullishDI: false };

class TechnicalIndicators {
  // ─── Library indicator instances ─────────────────────────────────────────
  private rsiIndicator: TVRsi;
  private macdIndicator: TVMacd;
  private bbIndicator: TVBB;
  private atrIndicator: TVAtr;
  private stochIndicator: TVStoch;
  private adxIndicator: TVAdx;

  // ─── Previous values for crossover detection ─────────────────────────────
  private prevHistogram: number = 0;
  private prevStochK: number = 50;
  private prevStochD: number = 50;
  private lastRsi: RSIState = { ...DEFAULT_RSI };
  private lastMacd: MACDState = { ...DEFAULT_MACD };
  private lastBB: BollingerBandsState = { ...DEFAULT_BB };
  private lastStoch: StochasticState = { ...DEFAULT_STOCH };
  private lastAdx: ADXState = { ...DEFAULT_ADX };

  // ─── ATR history for percentile ranking ──────────────────────────────────
  private atrHistory: number[] = [];
  private readonly atrHistorySize: number = 200;

  // ─── Tick-to-candle aggregator (for ATR, Stochastic, ADX) ────────────────
  private tickPrices: number[] = [];
  private readonly tickWindow: number = 20; // ticks per pseudo-candle
  private lastCandle: { high: number; low: number; close: number } | null = null;
  private lastATR: ATRState = { ...DEFAULT_ATR };

  // Config
  private readonly rsiPeriod: number;

  constructor(
    rsiPeriod: number = 14,
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9,
    atrPeriod: number = 14,
  ) {
    this.rsiPeriod = rsiPeriod;

    // Initialize library indicators in streaming mode (empty values)
    this.rsiIndicator = new TVRsi({ period: rsiPeriod, values: [] });
    this.macdIndicator = new TVMacd({
      fastPeriod,
      slowPeriod,
      signalPeriod,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
      values: [],
    });
    this.bbIndicator = new TVBB({ period: 20, stdDev: 2, values: [] });
    this.atrIndicator = new TVAtr({ period: atrPeriod, high: [], low: [], close: [] });
    this.stochIndicator = new TVStoch({ period: 14, signalPeriod: 3, high: [], low: [], close: [] });
    this.adxIndicator = new TVAdx({ period: atrPeriod, high: [], low: [], close: [] });
  }

  update(price: number): TechnicalState {
    const rsi = this.updateRSI(price);
    const macd = this.updateMACD(price);
    const bollingerBands = this.updateBB(price);

    // Candle-based indicators: aggregate ticks, update on candle completion
    this.tickPrices.push(price);
    let atr = this.lastATR;
    let stochastic = this.lastStoch;
    let adx = this.lastAdx;

    if (this.tickPrices.length >= this.tickWindow) {
      const candle = this.buildCandle();
      atr = this.updateATR(candle);
      stochastic = this.updateStochastic(candle);
      adx = this.updateADX(candle);
      this.lastCandle = candle;
      this.tickPrices = [price]; // start next window
    }

    return { rsi, macd, atr, bollingerBands, stochastic, adx };
  }

  // ─── Tick-to-candle helper ─────────────────────────────────────────────
  private buildCandle(): { high: number; low: number; close: number } {
    const high = Math.max(...this.tickPrices);
    const low = Math.min(...this.tickPrices);
    const close = this.tickPrices[this.tickPrices.length - 1];
    return { high, low, close };
  }

  // ─── RSI (TradingView-accurate Wilder's smoothing) ─────────────────────
  private updateRSI(price: number): RSIState {
    const val = this.rsiIndicator.nextValue(price);
    if (val === undefined) return this.lastRsi;
    const rsiValue = val;
    this.lastRsi = {
      value: rsiValue,
      isOverbought: rsiValue > 70,
      isOversold: rsiValue < 30,
      inRange: rsiValue > 30 && rsiValue < 70,
    };
    return this.lastRsi;
  }

  // ─── MACD (TradingView-accurate EMA seeding) ──────────────────────────
  private updateMACD(price: number): MACDState {
    const val = this.macdIndicator.nextValue(price);
    if (val === undefined || val.MACD === undefined) return this.lastMacd;

    const macdLine = val.MACD;
    const signalLine = val.signal ?? 0;
    const histogram = val.histogram ?? 0;

    // Crossover detection
    const bullishCrossover = histogram > 0 && this.prevHistogram <= 0;
    const bearishCrossover = histogram < 0 && this.prevHistogram >= 0;
    this.prevHistogram = histogram;

    const aligned: 'bullish' | 'bearish' | 'neutral' =
      macdLine > signalLine && macdLine > 0 ? 'bullish' :
      macdLine < signalLine && macdLine < 0 ? 'bearish' : 'neutral';

    this.lastMacd = { macdLine, signalLine, histogram, bullishCrossover, bearishCrossover, aligned };
    return this.lastMacd;
  }

  // ─── Bollinger Bands ───────────────────────────────────────────────────
  private updateBB(price: number): BollingerBandsState {
    const val = this.bbIndicator.nextValue(price);
    if (val === undefined) return this.lastBB;

    const bandwidth = val.middle > 0 ? (val.upper - val.lower) / val.middle : 0;
    const range = val.upper - val.lower;
    const percentB = range > 0 ? (price - val.lower) / range : 0.5;

    this.lastBB = {
      upper: val.upper,
      middle: val.middle,
      lower: val.lower,
      bandwidth,
      percentB,
      squeeze: bandwidth < 0.02,
    };
    return this.lastBB;
  }

  // ─── ATR (TradingView-accurate True Range) ────────────────────────────
  private updateATR(candle: { high: number; low: number; close: number }): ATRState {
    const val = this.atrIndicator.nextValue(candle as { open: number; high: number; low: number; close: number });
    if (val === undefined) return this.lastATR;

    const atrValue = val;

    // Track history for percentile
    this.atrHistory.push(atrValue);
    if (this.atrHistory.length > this.atrHistorySize) {
      this.atrHistory.shift();
    }

    // Percentile calculation
    let percentile = 0.5;
    if (this.atrHistory.length >= 5) {
      const sorted = [...this.atrHistory].sort((a, b) => a - b);
      const rank = sorted.filter(v => v <= atrValue).length;
      percentile = rank / sorted.length;
    }

    this.lastATR = {
      value: atrValue,
      percentile,
      isExtreme: percentile > 0.9,
      isNormal: percentile > 0.1 && percentile < 0.9,
    };
    return this.lastATR;
  }

  // ─── Stochastic Oscillator ────────────────────────────────────────────
  private updateStochastic(candle: { high: number; low: number; close: number }): StochasticState {
    const val = this.stochIndicator.nextValue(candle as never);
    if (val === undefined) return this.lastStoch;

    const k = val.k;
    const d = val.d;

    // Crossover detection from overbought/oversold zones
    const bullishCrossover = k > d && this.prevStochK <= this.prevStochD && this.prevStochK < 20;
    const bearishCrossover = k < d && this.prevStochK >= this.prevStochD && this.prevStochK > 80;
    this.prevStochK = k;
    this.prevStochD = d;

    this.lastStoch = {
      k,
      d,
      isOverbought: k > 80,
      isOversold: k < 20,
      bullishCrossover,
      bearishCrossover,
    };
    return this.lastStoch;
  }

  // ─── ADX (Average Directional Index) ──────────────────────────────────
  private updateADX(candle: { high: number; low: number; close: number }): ADXState {
    const val = this.adxIndicator.nextValue(candle as never);
    if (val === undefined) return this.lastAdx;

    this.lastAdx = {
      adx: val.adx,
      pdi: val.pdi,
      mdi: val.mdi,
      isTrending: val.adx > 25,
      isStrong: val.adx > 40,
      bullishDI: val.pdi > val.mdi,
    };
    return this.lastAdx;
  }

  getRSI(): number {
    return this.lastRsi.value;
  }

  reset(): void {
    this.rsiIndicator = new TVRsi({ period: this.rsiPeriod, values: [] });
    this.macdIndicator = new TVMacd({
      fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      SimpleMAOscillator: false, SimpleMASignal: false, values: [],
    });
    this.bbIndicator = new TVBB({ period: 20, stdDev: 2, values: [] });
    this.atrIndicator = new TVAtr({ period: this.rsiPeriod, high: [], low: [], close: [] });
    this.stochIndicator = new TVStoch({ period: 14, signalPeriod: 3, high: [], low: [], close: [] });
    this.adxIndicator = new TVAdx({ period: this.rsiPeriod, high: [], low: [], close: [] });
    this.prevHistogram = 0;
    this.prevStochK = 50;
    this.prevStochD = 50;
    this.lastRsi = { ...DEFAULT_RSI };
    this.lastMacd = { ...DEFAULT_MACD };
    this.lastBB = { ...DEFAULT_BB };
    this.lastStoch = { ...DEFAULT_STOCH };
    this.lastAdx = { ...DEFAULT_ADX };
    this.atrHistory = [];
    this.tickPrices = [];
    this.lastCandle = null;
    this.lastATR = { ...DEFAULT_ATR };
  }
}

export default TechnicalIndicators;
