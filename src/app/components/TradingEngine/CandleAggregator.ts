// src/tradingEngine/CandleAggregator.ts
// Aggregates tick data into 15-minute candles and computes rolling ATR, volume percentile, StdDev

import type { Candle15m, SymbolInput } from './MarketCharacteristor';

export interface TickData {
  price: number;
  volume: number;
  timestamp: number;
}

export interface AggregatorState {
  currentCandle: Candle15m | null;
  completedCandles: Candle15m[];
  atr: number;
  atrPercentile: number;
  volumePercentile: number;
  stdDev: number;
  prevStdDev: number;
  momentum: number;
}

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

class CandleAggregator {
  private symbol: string;
  private candleIntervalMs: number;
  private currentCandle: Candle15m | null = null;
  private completedCandles: Candle15m[] = [];
  private readonly maxCandles: number;

  // Rolling ATR
  private atrHistory: number[] = [];
  private readonly atrPeriod: number = 14;

  // Rolling volume
  private volumeHistory: number[] = [];
  private readonly volumeWindow: number = 100;

  // Rolling StdDev
  private priceHistory: number[] = [];
  private readonly stdDevWindow: number = 20;
  private prevStdDev: number = 0;

  // Momentum
  private prevPrice: number = 0;

  constructor(symbol: string = 'BTCUSD', candleIntervalMs: number = FIFTEEN_MIN_MS, maxCandles: number = 200) {
    this.symbol = symbol;
    this.candleIntervalMs = candleIntervalMs;
    this.maxCandles = maxCandles;
  }

  // ─── Main: Process a tick ─────────────────────────────────────────────────

  processTick(tick: TickData): { candleCompleted: boolean; candle: Candle15m | null } {
    const candleStart = Math.floor(tick.timestamp / this.candleIntervalMs) * this.candleIntervalMs;

    if (!this.currentCandle || this.currentCandle.timestamp !== candleStart) {
      // Close previous candle
      if (this.currentCandle) {
        this.closeCandle(this.currentCandle);
      }

      // Start new candle
      this.currentCandle = {
        high: tick.price,
        low: tick.price,
        open: tick.price,
        close: tick.price,
        volume: tick.volume,
        timestamp: candleStart,
      };

      this.updateMomentum(tick.price);
      return { candleCompleted: !!this.completedCandles.length, candle: this.getLastCompletedCandle() };
    }

    // Update current candle
    this.currentCandle.high = Math.max(this.currentCandle.high, tick.price);
    this.currentCandle.low = Math.min(this.currentCandle.low, tick.price);
    this.currentCandle.close = tick.price;
    this.currentCandle.volume += tick.volume;

    this.updateMomentum(tick.price);
    return { candleCompleted: false, candle: null };
  }

  // ─── Close a candle and update indicators ─────────────────────────────────

  private closeCandle(candle: Candle15m): void {
    this.completedCandles.push(candle);
    if (this.completedCandles.length > this.maxCandles) {
      this.completedCandles.shift();
    }

    // Update ATR
    this.updateATR(candle);

    // Update volume history
    this.volumeHistory.push(candle.volume);
    if (this.volumeHistory.length > this.volumeWindow) {
      this.volumeHistory.shift();
    }

    // Update StdDev
    this.updateStdDev(candle.close);
  }

  // ─── ATR Calculation ──────────────────────────────────────────────────────

  private updateATR(candle: Candle15m): void {
    const prev = this.completedCandles.length >= 2
      ? this.completedCandles[this.completedCandles.length - 2]
      : null;

    const tr = prev
      ? Math.max(
          candle.high - candle.low,
          Math.abs(candle.high - prev.close),
          Math.abs(candle.low - prev.close)
        )
      : candle.high - candle.low;

    this.atrHistory.push(tr);
    if (this.atrHistory.length > this.volumeWindow) {
      this.atrHistory.shift();
    }
  }

  getATR(): number {
    if (this.atrHistory.length === 0) return 0;
    const period = Math.min(this.atrPeriod, this.atrHistory.length);
    let sum = 0;
    for (let i = this.atrHistory.length - period; i < this.atrHistory.length; i++) {
      sum += this.atrHistory[i];
    }
    return sum / period;
  }

  getATRPercentile(): number {
    if (this.atrHistory.length < 2) return 0.5;
    const currentATR = this.getATR();
    const sorted = [...this.atrHistory].sort((a, b) => a - b);
    const rank = sorted.filter(v => v <= currentATR).length;
    return rank / sorted.length;
  }

  // ─── Volume Percentile ────────────────────────────────────────────────────

  getVolumePercentile(): number {
    if (this.volumeHistory.length < 2) return 0.5;
    const currentVol = this.currentCandle?.volume ?? 0;
    const sorted = [...this.volumeHistory].sort((a, b) => a - b);
    const rank = sorted.filter(v => v <= currentVol).length;
    return rank / sorted.length;
  }

  // ─── StdDev Calculation ───────────────────────────────────────────────────

  private updateStdDev(price: number): void {
    this.priceHistory.push(price);
    if (this.priceHistory.length > this.stdDevWindow) {
      this.priceHistory.shift();
    }
    this.prevStdDev = this.getStdDev();
  }

  getStdDev(): number {
    if (this.priceHistory.length < 2) return 0;
    const mean = this.priceHistory.reduce((a, b) => a + b, 0) / this.priceHistory.length;
    const variance = this.priceHistory.reduce((sum, p) => sum + (p - mean) ** 2, 0) / this.priceHistory.length;
    return Math.sqrt(variance);
  }

  getPrevStdDev(): number {
    return this.prevStdDev;
  }

  // ─── Momentum ─────────────────────────────────────────────────────────────

  private updateMomentum(price: number): void {
    this.prevPrice = price;
  }

  getMomentum(): number {
    if (!this.currentCandle || this.currentCandle.open === 0) return 0;
    return (this.currentCandle.close - this.currentCandle.open) / this.currentCandle.open;
  }

  // ─── Build SymbolInput for MarketCharacteristor ───────────────────────────

  buildSymbolInput(
    price: number,
    macdDivergence: boolean = false,
    rsiDivergence: boolean = false
  ): SymbolInput | null {
    const candle = this.getCurrentOrLastCandle();
    if (!candle) return null;

    return {
      symbol: this.symbol,
      price,
      candle15m: candle,
      atr: this.getATR(),
      atrPercentile: this.getATRPercentile(),
      volumePercentile: this.getVolumePercentile(),
      stdDev: this.getStdDev(),
      prevStdDev: this.getPrevStdDev(),
      momentum: this.getMomentum(),
      macdDivergence,
      rsiDivergence,
    };
  }

  // ─── Accessors ────────────────────────────────────────────────────────────

  getCurrentCandle(): Candle15m | null {
    return this.currentCandle;
  }

  getLastCompletedCandle(): Candle15m | null {
    return this.completedCandles.length > 0
      ? this.completedCandles[this.completedCandles.length - 1]
      : null;
  }

  getCurrentOrLastCandle(): Candle15m | null {
    return this.currentCandle ?? this.getLastCompletedCandle();
  }

  getCompletedCandles(): Candle15m[] {
    return [...this.completedCandles];
  }

  getState(): AggregatorState {
    return {
      currentCandle: this.currentCandle,
      completedCandles: [...this.completedCandles],
      atr: this.getATR(),
      atrPercentile: this.getATRPercentile(),
      volumePercentile: this.getVolumePercentile(),
      stdDev: this.getStdDev(),
      prevStdDev: this.getPrevStdDev(),
      momentum: this.getMomentum(),
    };
  }
}

export default CandleAggregator;
