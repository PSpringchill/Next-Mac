// ─── ZigZag Swing Detector ───────────────────────────────────────────────────
// Identifies swing highs and swing lows from price series.
// Works alongside KalmanTrendFilter to confirm trend reversals.
// A swing low confirms bullish reversal; a swing high confirms bearish reversal.

export interface ZigZagState {
  lastSwingHigh: number | null;
  lastSwingLow: number | null;
  lastSwingHighIdx: number;
  lastSwingLowIdx: number;
  isSwingLow: boolean;      // Current point is a confirmed swing low
  isSwingHigh: boolean;     // Current point is a confirmed swing high
  direction: 'up' | 'down' | 'none'; // Current ZigZag leg direction
  swingCount: number;
}

class ZigZagDetector {
  private prices: number[] = [];
  private readonly threshold: number;  // Minimum % move to qualify as a swing
  private readonly lookback: number;   // Bars to confirm a swing point

  private lastSwingHigh: number | null = null;
  private lastSwingLow: number | null = null;
  private lastSwingHighIdx: number = -1;
  private lastSwingLowIdx: number = -1;
  private direction: 'up' | 'down' | 'none' = 'none';
  private swingCount: number = 0;
  private tickIndex: number = 0;

  constructor(threshold: number = 0.003, lookback: number = 5) {
    this.threshold = threshold;
    this.lookback = lookback;
  }

  update(price: number): ZigZagState {
    this.prices.push(price);
    this.tickIndex++;

    let isSwingHigh = false;
    let isSwingLow = false;

    const n = this.prices.length;
    if (n < this.lookback * 2 + 1) {
      return this.buildState(false, false);
    }

    // Check if the point at (n - 1 - lookback) is a swing point
    const pivotIdx = n - 1 - this.lookback;
    const pivotPrice = this.prices[pivotIdx];

    // Swing High: pivot is higher than all surrounding points within lookback
    let isPivotHigh = true;
    let isPivotLow = true;

    for (let i = pivotIdx - this.lookback; i <= pivotIdx + this.lookback; i++) {
      if (i === pivotIdx) continue;
      if (i < 0 || i >= n) continue;
      if (this.prices[i] >= pivotPrice) isPivotHigh = false;
      if (this.prices[i] <= pivotPrice) isPivotLow = false;
    }

    // Apply threshold filter: swing must be at least threshold% from last opposite swing
    if (isPivotHigh) {
      if (this.lastSwingLow !== null) {
        const move = (pivotPrice - this.lastSwingLow) / this.lastSwingLow;
        if (move < this.threshold) isPivotHigh = false;
      }
      if (isPivotHigh) {
        this.lastSwingHigh = pivotPrice;
        this.lastSwingHighIdx = pivotIdx;
        this.direction = 'down'; // After swing high, expect downward leg
        this.swingCount++;
        isSwingHigh = true;
      }
    }

    if (isPivotLow) {
      if (this.lastSwingHigh !== null) {
        const move = (this.lastSwingHigh - pivotPrice) / this.lastSwingHigh;
        if (move < this.threshold) isPivotLow = false;
      }
      if (isPivotLow) {
        this.lastSwingLow = pivotPrice;
        this.lastSwingLowIdx = pivotIdx;
        this.direction = 'up'; // After swing low, expect upward leg
        this.swingCount++;
        isSwingLow = true;
      }
    }

    // Trim old prices to prevent unbounded growth
    if (this.prices.length > 500) {
      const trim = this.prices.length - 300;
      this.prices = this.prices.slice(trim);
      this.lastSwingHighIdx = Math.max(0, this.lastSwingHighIdx - trim);
      this.lastSwingLowIdx = Math.max(0, this.lastSwingLowIdx - trim);
    }

    return this.buildState(isSwingHigh, isSwingLow);
  }

  private buildState(isSwingHigh: boolean, isSwingLow: boolean): ZigZagState {
    return {
      lastSwingHigh: this.lastSwingHigh,
      lastSwingLow: this.lastSwingLow,
      lastSwingHighIdx: this.lastSwingHighIdx,
      lastSwingLowIdx: this.lastSwingLowIdx,
      isSwingHigh,
      isSwingLow,
      direction: this.direction,
      swingCount: this.swingCount,
    };
  }

  getState(): ZigZagState {
    return this.buildState(false, false);
  }

  reset(): void {
    this.prices = [];
    this.lastSwingHigh = null;
    this.lastSwingLow = null;
    this.lastSwingHighIdx = -1;
    this.lastSwingLowIdx = -1;
    this.direction = 'none';
    this.swingCount = 0;
    this.tickIndex = 0;
  }
}

export default ZigZagDetector;
