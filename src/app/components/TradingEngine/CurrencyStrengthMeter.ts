// ─── Currency Strength Meter ─────────────────────────────────────────────────
// Estimates base/quote currency strength from order flow dynamics.
// In crypto (e.g. BNBUSDT): base = BNB, quote = USDT.
//
// Base strength rises when: heavy bid volume, positive OBI, aggressive buys.
// Quote strength rises when: heavy ask volume, negative OBI, aggressive sells.
//
// Output: strength scores [0, 100] for each currency + divergence metric.

export interface CurrencyStrengthState {
  baseStrength: number;    // [0, 100] — higher = stronger base
  quoteStrength: number;   // [0, 100] — higher = stronger quote
  divergence: number;      // baseStrength - quoteStrength
  longCondition: boolean;  // base > 55 && quote < 45 || divergence > 15
  shortCondition: boolean; // base < 45 && quote > 55 || divergence < -15
}

class CurrencyStrengthMeter {
  private obiHistory: number[] = [];
  private returnHistory: number[] = [];
  private volumeImbalanceHistory: number[] = [];
  private prevPrice: number = 0;
  private readonly window: number;
  private readonly emaAlpha: number;
  private baseEMA: number = 50;
  private quoteEMA: number = 50;

  constructor(window: number = 30) {
    this.window = window;
    this.emaAlpha = 2 / (window + 1);
  }

  update(price: number, obi: number, bidVolume: number, askVolume: number): CurrencyStrengthState {
    // Track OBI history
    this.obiHistory.push(obi);
    if (this.obiHistory.length > this.window) this.obiHistory.shift();

    // Track returns
    const ret = this.prevPrice > 0 ? (price - this.prevPrice) / this.prevPrice : 0;
    this.returnHistory.push(ret);
    if (this.returnHistory.length > this.window) this.returnHistory.shift();

    // Volume imbalance: normalized (bid - ask) / (bid + ask)
    const totalVol = bidVolume + askVolume;
    const volImbalance = totalVol > 0 ? (bidVolume - askVolume) / totalVol : 0;
    this.volumeImbalanceHistory.push(volImbalance);
    if (this.volumeImbalanceHistory.length > this.window) this.volumeImbalanceHistory.shift();

    this.prevPrice = price;

    // Compute raw strength signals
    const avgOBI = this.obiHistory.reduce((s, v) => s + v, 0) / this.obiHistory.length;
    const avgReturn = this.returnHistory.reduce((s, v) => s + v, 0) / this.returnHistory.length;
    const avgVolImbalance = this.volumeImbalanceHistory.reduce((s, v) => s + v, 0) / this.volumeImbalanceHistory.length;

    // Base strength: combination of positive OBI, positive returns, buy volume dominance
    // Map to [0, 100] via sigmoid-like transform
    const baseRaw = (avgOBI / 100) * 0.4     // OBI contribution [-0.4, 0.4]
                  + avgReturn * 500 * 0.3     // Return contribution
                  + avgVolImbalance * 0.3;    // Volume imbalance contribution

    const quoteRaw = -baseRaw; // Quote is inverse of base for single-pair

    // Sigmoid mapping to [0, 100]
    const baseStrengthRaw = 50 + 50 * Math.tanh(baseRaw * 3);
    const quoteStrengthRaw = 50 + 50 * Math.tanh(quoteRaw * 3);

    // EMA smoothing
    this.baseEMA = this.emaAlpha * baseStrengthRaw + (1 - this.emaAlpha) * this.baseEMA;
    this.quoteEMA = this.emaAlpha * quoteStrengthRaw + (1 - this.emaAlpha) * this.quoteEMA;

    const baseStrength = Math.max(0, Math.min(100, this.baseEMA));
    const quoteStrength = Math.max(0, Math.min(100, this.quoteEMA));
    const divergence = baseStrength - quoteStrength;

    return {
      baseStrength,
      quoteStrength,
      divergence,
      longCondition: (baseStrength > 55 && quoteStrength < 45) || divergence > 15,
      shortCondition: (baseStrength < 45 && quoteStrength > 55) || divergence < -15,
    };
  }

  getState(): CurrencyStrengthState {
    return {
      baseStrength: this.baseEMA,
      quoteStrength: this.quoteEMA,
      divergence: this.baseEMA - this.quoteEMA,
      longCondition: (this.baseEMA > 55 && this.quoteEMA < 45) || (this.baseEMA - this.quoteEMA) > 15,
      shortCondition: (this.baseEMA < 45 && this.quoteEMA > 55) || (this.baseEMA - this.quoteEMA) < -15,
    };
  }

  reset(): void {
    this.obiHistory = [];
    this.returnHistory = [];
    this.volumeImbalanceHistory = [];
    this.prevPrice = 0;
    this.baseEMA = 50;
    this.quoteEMA = 50;
  }
}

export default CurrencyStrengthMeter;
