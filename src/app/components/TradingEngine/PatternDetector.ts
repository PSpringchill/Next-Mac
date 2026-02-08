// ─── Candlestick Pattern Detector ────────────────────────────────────────────
// Detects common bullish/bearish candlestick patterns from OHLC data.
// Patterns: Hammer, Inverted Hammer, Bullish/Bearish Engulfing, Doji,
//           Morning/Evening Star, Shooting Star.

export interface CandleOHLC {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type PatternType =
  | 'hammer'
  | 'inverted_hammer'
  | 'bullish_engulfing'
  | 'bearish_engulfing'
  | 'doji'
  | 'morning_star'
  | 'evening_star'
  | 'shooting_star'
  | 'piercing_line'
  | 'dark_cloud';

export interface DetectedPattern {
  type: PatternType;
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: number; // [0, 1]
}

export interface PatternState {
  patterns: DetectedPattern[];
  hasBullish: boolean;
  hasBearish: boolean;
  noBearish: boolean;
  noBullish: boolean;
  strongestBullish: number; // strength of strongest bullish [0, 1]
  strongestBearish: number; // strength of strongest bearish [0, 1]
}

class PatternDetector {
  private candles: CandleOHLC[] = [];
  private readonly maxCandles: number;

  constructor(maxCandles: number = 50) {
    this.maxCandles = maxCandles;
  }

  addCandle(candle: CandleOHLC): PatternState {
    this.candles.push(candle);
    if (this.candles.length > this.maxCandles) {
      this.candles.shift();
    }
    return this.detect();
  }

  detect(): PatternState {
    const patterns: DetectedPattern[] = [];
    const n = this.candles.length;
    if (n < 1) {
      return { patterns, hasBullish: false, hasBearish: false, noBearish: true, noBullish: true, strongestBullish: 0, strongestBearish: 0 };
    }

    const c = this.candles[n - 1];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const isBullish = c.close > c.open;

    // ── Doji ──
    if (range > 0 && body / range < 0.1) {
      patterns.push({ type: 'doji', direction: 'neutral', strength: 0.5 });
    }

    // ── Hammer (bullish) ──
    // Small body at top, long lower wick (>2x body), minimal upper wick
    if (lowerWick > body * 2 && upperWick < body * 0.5 && range > 0) {
      const strength = Math.min(1, lowerWick / (range + 1e-10));
      patterns.push({ type: 'hammer', direction: 'bullish', strength });
    }

    // ── Inverted Hammer (bullish, in downtrend context) ──
    if (upperWick > body * 2 && lowerWick < body * 0.5 && !isBullish && range > 0) {
      const strength = Math.min(1, upperWick / (range + 1e-10));
      patterns.push({ type: 'inverted_hammer', direction: 'bullish', strength: strength * 0.8 });
    }

    // ── Shooting Star (bearish) ──
    if (upperWick > body * 2 && lowerWick < body * 0.5 && isBullish && range > 0) {
      const strength = Math.min(1, upperWick / (range + 1e-10));
      patterns.push({ type: 'shooting_star', direction: 'bearish', strength });
    }

    // Two-candle patterns need at least 2 candles
    if (n >= 2) {
      const prev = this.candles[n - 2];
      const prevBody = Math.abs(prev.close - prev.open);
      const prevIsBullish = prev.close > prev.open;

      // ── Bullish Engulfing ──
      if (!prevIsBullish && isBullish && c.open <= prev.close && c.close >= prev.open && body > prevBody) {
        const strength = Math.min(1, body / (prevBody + 1e-10) * 0.5);
        patterns.push({ type: 'bullish_engulfing', direction: 'bullish', strength });
      }

      // ── Bearish Engulfing ──
      if (prevIsBullish && !isBullish && c.open >= prev.close && c.close <= prev.open && body > prevBody) {
        const strength = Math.min(1, body / (prevBody + 1e-10) * 0.5);
        patterns.push({ type: 'bearish_engulfing', direction: 'bearish', strength });
      }

      // ── Piercing Line (bullish) ──
      if (!prevIsBullish && isBullish && c.open < prev.low && c.close > (prev.open + prev.close) / 2) {
        patterns.push({ type: 'piercing_line', direction: 'bullish', strength: 0.7 });
      }

      // ── Dark Cloud Cover (bearish) ──
      if (prevIsBullish && !isBullish && c.open > prev.high && c.close < (prev.open + prev.close) / 2) {
        patterns.push({ type: 'dark_cloud', direction: 'bearish', strength: 0.7 });
      }
    }

    // Three-candle patterns
    if (n >= 3) {
      const c1 = this.candles[n - 3];
      const c2 = this.candles[n - 2];
      const c3 = this.candles[n - 1];
      const body2 = Math.abs(c2.close - c2.open);
      const range2 = c2.high - c2.low;

      // ── Morning Star (bullish) ──
      if (c1.close < c1.open           // First candle bearish
        && body2 < range2 * 0.3        // Middle candle small body (star)
        && c3.close > c3.open          // Third candle bullish
        && c3.close > (c1.open + c1.close) / 2) { // Third closes above midpoint of first
        patterns.push({ type: 'morning_star', direction: 'bullish', strength: 0.85 });
      }

      // ── Evening Star (bearish) ──
      if (c1.close > c1.open           // First candle bullish
        && body2 < range2 * 0.3        // Middle candle small body (star)
        && c3.close < c3.open          // Third candle bearish
        && c3.close < (c1.open + c1.close) / 2) { // Third closes below midpoint of first
        patterns.push({ type: 'evening_star', direction: 'bearish', strength: 0.85 });
      }
    }

    const hasBullish = patterns.some(p => p.direction === 'bullish');
    const hasBearish = patterns.some(p => p.direction === 'bearish');
    const strongestBullish = patterns
      .filter(p => p.direction === 'bullish')
      .reduce((max, p) => Math.max(max, p.strength), 0);
    const strongestBearish = patterns
      .filter(p => p.direction === 'bearish')
      .reduce((max, p) => Math.max(max, p.strength), 0);

    return {
      patterns,
      hasBullish,
      hasBearish,
      noBearish: !hasBearish,
      noBullish: !hasBullish,
      strongestBullish,
      strongestBearish,
    };
  }

  getState(): PatternState {
    return this.detect();
  }

  reset(): void {
    this.candles = [];
  }
}

export default PatternDetector;
