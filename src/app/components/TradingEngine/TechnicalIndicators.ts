// ─── Technical Indicators: RSI, MACD, ATR ────────────────────────────────────
// Rolling computations over price series for regime filtering.

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

export interface TechnicalState {
  rsi: RSIState;
  macd: MACDState;
  atr: ATRState;
}

class TechnicalIndicators {
  // RSI
  private readonly rsiPeriod: number;
  private gains: number[] = [];
  private losses: number[] = [];
  private prevPrice: number = 0;
  private avgGain: number = 0;
  private avgLoss: number = 0;
  private rsiCount: number = 0;

  // MACD
  private readonly fastPeriod: number;
  private readonly slowPeriod: number;
  private readonly signalPeriod: number;
  private fastEMA: number = 0;
  private slowEMA: number = 0;
  private signalEMA: number = 0;
  private prevMacdLine: number = 0;
  private macdCount: number = 0;

  // ATR
  private readonly atrPeriod: number;
  private atrValues: number[] = [];
  private atrHistory: number[] = [];
  private prevCandle: { high: number; low: number; close: number } | null = null;
  private readonly atrHistorySize: number = 200;

  // Price tracking for candle simulation
  private tickPrices: number[] = [];
  private readonly tickWindow: number = 20; // ticks per pseudo-candle

  constructor(
    rsiPeriod: number = 14,
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9,
    atrPeriod: number = 14,
  ) {
    this.rsiPeriod = rsiPeriod;
    this.fastPeriod = fastPeriod;
    this.slowPeriod = slowPeriod;
    this.signalPeriod = signalPeriod;
    this.atrPeriod = atrPeriod;
  }

  update(price: number): TechnicalState {
    this.tickPrices.push(price);
    const rsi = this.updateRSI(price);
    const macd = this.updateMACD(price);
    const atr = this.updateATR(price);
    this.prevPrice = price;
    return { rsi, macd, atr };
  }

  // ─── RSI ─────────────────────────────────────────────────────────────────
  private updateRSI(price: number): RSIState {
    if (this.prevPrice === 0) {
      return { value: 50, isOverbought: false, isOversold: false, inRange: true };
    }

    const change = price - this.prevPrice;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    this.rsiCount++;

    if (this.rsiCount <= this.rsiPeriod) {
      this.gains.push(gain);
      this.losses.push(loss);
      if (this.rsiCount === this.rsiPeriod) {
        this.avgGain = this.gains.reduce((s, g) => s + g, 0) / this.rsiPeriod;
        this.avgLoss = this.losses.reduce((s, l) => s + l, 0) / this.rsiPeriod;
      }
      return { value: 50, isOverbought: false, isOversold: false, inRange: true };
    }

    // Wilder's smoothing
    this.avgGain = (this.avgGain * (this.rsiPeriod - 1) + gain) / this.rsiPeriod;
    this.avgLoss = (this.avgLoss * (this.rsiPeriod - 1) + loss) / this.rsiPeriod;

    const rs = this.avgLoss > 0 ? this.avgGain / this.avgLoss : 100;
    const rsiValue = 100 - (100 / (1 + rs));

    return {
      value: rsiValue,
      isOverbought: rsiValue > 70,
      isOversold: rsiValue < 30,
      inRange: rsiValue > 30 && rsiValue < 70,
    };
  }

  // ─── MACD ────────────────────────────────────────────────────────────────
  private updateMACD(price: number): MACDState {
    this.macdCount++;

    if (this.macdCount === 1) {
      this.fastEMA = price;
      this.slowEMA = price;
      this.signalEMA = 0;
      return { macdLine: 0, signalLine: 0, histogram: 0, bullishCrossover: false, bearishCrossover: false, aligned: 'neutral' };
    }

    // EMA update: EMA_new = price * k + EMA_old * (1 - k)
    const fastK = 2 / (this.fastPeriod + 1);
    const slowK = 2 / (this.slowPeriod + 1);
    const signalK = 2 / (this.signalPeriod + 1);

    this.fastEMA = price * fastK + this.fastEMA * (1 - fastK);
    this.slowEMA = price * slowK + this.slowEMA * (1 - slowK);

    const macdLine = this.fastEMA - this.slowEMA;

    if (this.macdCount <= this.slowPeriod) {
      this.signalEMA = macdLine;
      this.prevMacdLine = macdLine;
      return { macdLine, signalLine: macdLine, histogram: 0, bullishCrossover: false, bearishCrossover: false, aligned: 'neutral' };
    }

    this.signalEMA = macdLine * signalK + this.signalEMA * (1 - signalK);
    const histogram = macdLine - this.signalEMA;

    // Crossover detection
    const prevHistogram = this.prevMacdLine - this.signalEMA; // approximate
    const bullishCrossover = histogram > 0 && prevHistogram <= 0;
    const bearishCrossover = histogram < 0 && prevHistogram >= 0;

    const aligned: 'bullish' | 'bearish' | 'neutral' =
      macdLine > this.signalEMA && macdLine > 0 ? 'bullish' :
      macdLine < this.signalEMA && macdLine < 0 ? 'bearish' : 'neutral';

    this.prevMacdLine = macdLine;

    return { macdLine, signalLine: this.signalEMA, histogram, bullishCrossover, bearishCrossover, aligned };
  }

  // ─── ATR (tick-based approximation) ──────────────────────────────────────
  private updateATR(price: number): ATRState {
    if (this.tickPrices.length < 2) {
      return { value: 0, percentile: 0.5, isExtreme: false, isNormal: true };
    }

    // Use rolling window of prices to compute true range
    if (this.tickPrices.length >= this.tickWindow) {
      const window = this.tickPrices.slice(-this.tickWindow);
      const high = Math.max(...window);
      const low = Math.min(...window);
      const close = window[window.length - 1];

      let tr: number;
      if (this.prevCandle) {
        tr = Math.max(
          high - low,
          Math.abs(high - this.prevCandle.close),
          Math.abs(low - this.prevCandle.close),
        );
      } else {
        tr = high - low;
      }

      this.atrValues.push(tr);
      if (this.atrValues.length > this.atrPeriod * 3) {
        this.atrValues.shift();
      }

      this.atrHistory.push(tr);
      if (this.atrHistory.length > this.atrHistorySize) {
        this.atrHistory.shift();
      }

      this.prevCandle = { high, low, close };
      // Reset tick window
      this.tickPrices = [price];
    }

    // Compute ATR as SMA of recent true ranges
    const period = Math.min(this.atrPeriod, this.atrValues.length);
    if (period === 0) {
      return { value: 0, percentile: 0.5, isExtreme: false, isNormal: true };
    }

    let sum = 0;
    for (let i = this.atrValues.length - period; i < this.atrValues.length; i++) {
      sum += this.atrValues[i];
    }
    const atrValue = sum / period;

    // Percentile
    let percentile = 0.5;
    if (this.atrHistory.length >= 5) {
      const sorted = [...this.atrHistory].sort((a, b) => a - b);
      const rank = sorted.filter(v => v <= atrValue).length;
      percentile = rank / sorted.length;
    }

    return {
      value: atrValue,
      percentile,
      isExtreme: percentile > 0.9,
      isNormal: percentile > 0.1 && percentile < 0.9,
    };
  }

  getRSI(): number {
    const rs = this.avgLoss > 0 ? this.avgGain / this.avgLoss : 100;
    return this.rsiCount >= this.rsiPeriod ? 100 - (100 / (1 + rs)) : 50;
  }

  reset(): void {
    this.gains = [];
    this.losses = [];
    this.prevPrice = 0;
    this.avgGain = 0;
    this.avgLoss = 0;
    this.rsiCount = 0;
    this.fastEMA = 0;
    this.slowEMA = 0;
    this.signalEMA = 0;
    this.prevMacdLine = 0;
    this.macdCount = 0;
    this.atrValues = [];
    this.atrHistory = [];
    this.prevCandle = null;
    this.tickPrices = [];
  }
}

export default TechnicalIndicators;
