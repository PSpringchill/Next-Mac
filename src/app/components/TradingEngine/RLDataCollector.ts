// ─── RL Data Collector ───────────────────────────────────────────────────────
// Collects a rich indicator state vector into a 6-hour rolling buffer.
// Each snapshot captures: EMA crossovers, MACD, RSI, VWAP dev, OBI,
// price change %, Bollinger Bands, Stochastic, ADX, ATR, LinReg, volume.
// Used by RLBacktestTrainer to generate training experiences every 100 ticks.

import {
  RSI as TVRsi,
  EMA as TVEma,
  VWAP as TVVwap,
} from 'technicalindicators';
import type { TechnicalState } from './TechnicalIndicators';
import type { LinRegState } from './LinearRegressionTarget';

// ─── Snapshot: one tick of observation ───────────────────────────────────────

export interface RLSnapshot {
  timestamp: number;
  price: number;
  // ─── State vector features (normalized) ──────────────
  features: number[];
  // ─── Raw values for reward computation ───────────────
  raw: {
    price: number;
    atr: number;
    obi: number;
    spread: number;
  };
}

export interface RLCollectorState {
  bufferSize: number;
  maxCapacity: number;
  tickCount: number;
  oldestTimestamp: number;
  newestTimestamp: number;
  featureDim: number;
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  vwapDev: number;
}

// ─── Feature names for debugging/visualization ──────────────────────────────

export const RL_FEATURE_NAMES = [
  'rsi_norm',           // 0  RSI / 100
  'macd_hist_norm',     // 1  MACD histogram normalized by price
  'macd_aligned',       // 2  -1 bearish, 0 neutral, +1 bullish
  'ema9_21_cross',      // 3  (EMA9 - EMA21) / ATR
  'ema21_50_cross',     // 4  (EMA21 - EMA50) / ATR
  'ema50_200_cross',    // 5  (EMA50 - EMA200) / ATR
  'ema9_slope',         // 6  EMA9 rate of change
  'bb_percentB',        // 7  Bollinger %B
  'bb_squeeze',         // 8  1 if squeeze, 0 otherwise
  'bb_bandwidth',       // 9  Bandwidth
  'stoch_k_norm',       // 10 Stochastic K / 100
  'stoch_d_norm',       // 11 Stochastic D / 100
  'stoch_cross',        // 12 K-D normalized
  'adx_norm',           // 13 ADX / 100
  'adx_di_diff',        // 14 (PDI - MDI) / 100
  'atr_percentile',     // 15 ATR percentile [0,1]
  'vwap_dev',           // 16 (price - VWAP) / ATR
  'obi',                // 17 Order book imbalance [-1,1]
  'price_chg_1',        // 18 1-tick price change %
  'price_chg_5',        // 19 5-tick price change %
  'price_chg_20',       // 20 20-tick price change %
  'price_chg_50',       // 21 50-tick price change %
  'price_chg_100',      // 22 100-tick price change %
  'linreg_slope',       // 23 LinReg slope normalized
  'linreg_r2',          // 24 R-squared [0,1]
  'linreg_dev',         // 25 (price - target) / ATR
  'volume_roc',         // 26 Volume rate of change
  'spread_norm',        // 27 Spread / ATR
] as const;

export const RL_FEATURE_DIM = RL_FEATURE_NAMES.length; // 28

// ─── Welford Rolling Z-Score Normalizer ─────────────────────────────────────
// Maintains online mean/variance per feature using Welford's algorithm.
// Prevents blow-up in flat markets via a variance floor ε.

class RollingZScoreNormalizer {
  private count: number = 0;
  private mean: Float64Array;
  private m2: Float64Array;   // sum of squared deviations
  private readonly dim: number;
  private readonly epsilon: number;
  private readonly warmupTicks: number;

  constructor(dim: number, epsilon: number = 1e-6, warmupTicks: number = 50) {
    this.dim = dim;
    this.epsilon = epsilon;
    this.warmupTicks = warmupTicks;
    this.mean = new Float64Array(dim);
    this.m2 = new Float64Array(dim);
  }

  // Update running stats and return Z-scored features
  update(raw: number[]): number[] {
    this.count++;
    const n = this.count;
    const result = new Array<number>(this.dim);

    for (let i = 0; i < this.dim; i++) {
      const x = Number.isFinite(raw[i]) ? raw[i] : 0;
      const delta = x - this.mean[i];
      this.mean[i] += delta / n;
      const delta2 = x - this.mean[i];
      this.m2[i] += delta * delta2;

      // During warmup, pass through raw values (not enough data for stable stats)
      if (n < this.warmupTicks) {
        result[i] = x;
      } else {
        const variance = this.m2[i] / n;
        const std = Math.sqrt(Math.max(variance, this.epsilon));
        result[i] = (x - this.mean[i]) / std;
      }
    }
    return result;
  }

  isWarmedUp(): boolean {
    return this.count >= this.warmupTicks;
  }

  getStats(): { mean: number[]; variance: number[]; count: number } {
    const variance = new Array<number>(this.dim);
    for (let i = 0; i < this.dim; i++) {
      variance[i] = this.count > 0 ? this.m2[i] / this.count : 0;
    }
    return {
      mean: Array.from(this.mean),
      variance,
      count: this.count,
    };
  }

  reset(): void {
    this.count = 0;
    this.mean.fill(0);
    this.m2.fill(0);
  }
}

export { RollingZScoreNormalizer };

// ─── Configuration ──────────────────────────────────────────────────────────

export interface RLCollectorConfig {
  maxDurationMs: number;    // Rolling window duration (default: 6 hours)
  maxSnapshots: number;     // Max snapshots to keep (memory cap)
  zScoreEpsilon: number;    // Variance floor for Z-score normalization
  zScoreWarmup: number;     // Ticks before Z-score kicks in
}

const DEFAULT_CONFIG: RLCollectorConfig = {
  maxDurationMs: 6 * 60 * 60 * 1000,  // 6 hours
  maxSnapshots: 30000,                  // ~30k ticks ≈ 6hrs at ~800ms throttle
  zScoreEpsilon: 1e-6,                  // Variance floor ε
  zScoreWarmup: 50,                     // 50 ticks warmup
};

// ─── Collector ──────────────────────────────────────────────────────────────

class RLDataCollector {
  private config: RLCollectorConfig;
  private buffer: RLSnapshot[] = [];
  private tickCount: number = 0;

  // ─── Internal EMA indicators (additional to TechnicalIndicators) ──────
  private ema9: TVEma;
  private ema21: TVEma;
  private ema50: TVEma;
  private ema200: TVEma;
  private lastEma9: number = 0;
  private lastEma21: number = 0;
  private lastEma50: number = 0;
  private lastEma200: number = 0;
  private prevEma9: number = 0;

  // ─── VWAP tracking ───────────────────────────────────────────────────
  private vwapNumerator: number = 0;
  private vwapDenominator: number = 0;
  private lastVwap: number = 0;
  private vwapResetHour: number = -1;

  // ─── Price history for multi-timeframe returns ───────────────────────
  private priceHistory: number[] = [];
  private volumeHistory: number[] = [];
  private readonly priceHistoryMax = 120; // keep 120 ticks for lookback

  // ─── Rolling Z-Score normalizer (variance floor ε) ─────────────────
  private zNorm: RollingZScoreNormalizer;

  constructor(config?: Partial<RLCollectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.ema9 = new TVEma({ period: 9, values: [] });
    this.ema21 = new TVEma({ period: 21, values: [] });
    this.ema50 = new TVEma({ period: 50, values: [] });
    this.ema200 = new TVEma({ period: 200, values: [] });
    this.zNorm = new RollingZScoreNormalizer(
      RL_FEATURE_DIM,
      this.config.zScoreEpsilon,
      this.config.zScoreWarmup,
    );
  }

  // ─── Main collection method — call on every tick ─────────────────────

  collect(
    price: number,
    technicals: TechnicalState | null | undefined,
    linReg: LinRegState | null | undefined,
    obi: number,
    spread: number,
    volume: number,
  ): RLSnapshot {
    this.tickCount++;
    const now = Date.now();

    // Update EMAs
    this.prevEma9 = this.lastEma9;
    this.lastEma9 = this.ema9.nextValue(price) ?? (this.lastEma9 || price);
    this.lastEma21 = this.ema21.nextValue(price) ?? (this.lastEma21 || price);
    this.lastEma50 = this.ema50.nextValue(price) ?? (this.lastEma50 || price);
    this.lastEma200 = this.ema200.nextValue(price) ?? (this.lastEma200 || price);

    // Update VWAP (reset daily at UTC midnight)
    const currentHour = new Date().getUTCHours();
    if (currentHour === 0 && this.vwapResetHour !== 0) {
      this.vwapNumerator = 0;
      this.vwapDenominator = 0;
    }
    this.vwapResetHour = currentHour;
    const tickVolume = Math.max(volume, 1);
    this.vwapNumerator += price * tickVolume;
    this.vwapDenominator += tickVolume;
    this.lastVwap = this.vwapDenominator > 0 ? this.vwapNumerator / this.vwapDenominator : price;

    // Track price + volume history
    this.priceHistory.push(price);
    this.volumeHistory.push(tickVolume);
    if (this.priceHistory.length > this.priceHistoryMax) {
      this.priceHistory.shift();
      this.volumeHistory.shift();
    }

    // Build raw feature vector then apply rolling Z-score normalization
    const atr = technicals?.atr.value ?? 1e-8;
    const safeATR = Math.max(atr, price * 0.0001); // floor to 0.01%

    const rawFeatures = this.buildFeatures(price, technicals, linReg, obi, spread, safeATR, tickVolume);
    const features = this.zNorm.update(rawFeatures);
    // Clamp post-normalization to [-10, 10]
    for (let i = 0; i < RL_FEATURE_DIM; i++) {
      features[i] = Math.max(-10, Math.min(10, Number.isFinite(features[i]) ? features[i] : 0));
    }

    const snapshot: RLSnapshot = {
      timestamp: now,
      price,
      features,
      raw: { price, atr: safeATR, obi, spread },
    };

    // Add to buffer
    this.buffer.push(snapshot);

    // Prune: remove old snapshots beyond 6hr window or max capacity
    this.pruneBuffer(now);

    return snapshot;
  }

  // ─── Feature vector builder ──────────────────────────────────────────

  private buildFeatures(
    price: number,
    tech: TechnicalState | null | undefined,
    lr: LinRegState | null | undefined,
    obi: number,
    spread: number,
    atr: number,
    volume: number,
  ): number[] {
    const f = new Array<number>(RL_FEATURE_DIM).fill(0);

    // RSI
    f[0] = (tech?.rsi.value ?? 50) / 100;

    // MACD
    f[1] = price > 0 ? (tech?.macd.histogram ?? 0) / price * 1000 : 0; // normalize
    f[2] = tech?.macd.aligned === 'bullish' ? 1 : tech?.macd.aligned === 'bearish' ? -1 : 0;

    // EMA crossovers (normalized by ATR)
    f[3] = (this.lastEma9 - this.lastEma21) / atr;
    f[4] = (this.lastEma21 - this.lastEma50) / atr;
    f[5] = (this.lastEma50 - this.lastEma200) / atr;

    // EMA9 slope (rate of change)
    f[6] = this.prevEma9 > 0 ? (this.lastEma9 - this.prevEma9) / atr : 0;

    // Bollinger Bands
    f[7] = tech?.bollingerBands.percentB ?? 0.5;
    f[8] = tech?.bollingerBands.squeeze ? 1 : 0;
    f[9] = tech?.bollingerBands.bandwidth ?? 0;

    // Stochastic
    f[10] = (tech?.stochastic.k ?? 50) / 100;
    f[11] = (tech?.stochastic.d ?? 50) / 100;
    f[12] = ((tech?.stochastic.k ?? 50) - (tech?.stochastic.d ?? 50)) / 100;

    // ADX
    f[13] = (tech?.adx.adx ?? 0) / 100;
    f[14] = ((tech?.adx.pdi ?? 0) - (tech?.adx.mdi ?? 0)) / 100;

    // ATR percentile
    f[15] = tech?.atr.percentile ?? 0.5;

    // VWAP deviation
    f[16] = (price - this.lastVwap) / atr;

    // OBI (already normalized [-1, 1])
    f[17] = Math.max(-1, Math.min(1, obi));

    // Multi-timeframe price changes
    const ph = this.priceHistory;
    const n = ph.length;
    f[18] = n >= 2 ? (price - ph[n - 2]) / ph[n - 2] * 100 : 0;      // 1-tick
    f[19] = n >= 6 ? (price - ph[n - 6]) / ph[n - 6] * 100 : 0;      // 5-tick
    f[20] = n >= 21 ? (price - ph[n - 21]) / ph[n - 21] * 100 : 0;   // 20-tick
    f[21] = n >= 51 ? (price - ph[n - 51]) / ph[n - 51] * 100 : 0;   // 50-tick
    f[22] = n >= 101 ? (price - ph[n - 101]) / ph[n - 101] * 100 : 0; // 100-tick

    // LinReg
    f[23] = lr ? lr.slope / atr : 0;
    f[24] = lr?.rSquared ?? 0;
    f[25] = lr && lr.priceTarget > 0 ? (price - lr.priceTarget) / atr : 0;

    // Volume rate of change
    const vh = this.volumeHistory;
    const vn = vh.length;
    if (vn >= 21) {
      const recentVol = vh.slice(-5).reduce((s, v) => s + v, 0) / 5;
      const pastVol = vh.slice(-21, -5).reduce((s, v) => s + v, 0) / 16;
      f[26] = pastVol > 0 ? (recentVol - pastVol) / pastVol : 0;
    }

    // Spread normalized by ATR
    f[27] = spread / atr;

    return f;
  }

  // ─── Buffer management ───────────────────────────────────────────────

  private pruneBuffer(now: number): void {
    const cutoff = now - this.config.maxDurationMs;

    // Remove by time
    while (this.buffer.length > 0 && this.buffer[0].timestamp < cutoff) {
      this.buffer.shift();
    }

    // Remove by capacity
    while (this.buffer.length > this.config.maxSnapshots) {
      this.buffer.shift();
    }
  }

  // ─── Public accessors ────────────────────────────────────────────────

  getBuffer(): readonly RLSnapshot[] {
    return this.buffer;
  }

  getBufferSlice(fromIdx: number, toIdx?: number): RLSnapshot[] {
    return this.buffer.slice(fromIdx, toIdx);
  }

  getTickCount(): number {
    return this.tickCount;
  }

  getState(): RLCollectorState {
    return {
      bufferSize: this.buffer.length,
      maxCapacity: this.config.maxSnapshots,
      tickCount: this.tickCount,
      oldestTimestamp: this.buffer[0]?.timestamp ?? 0,
      newestTimestamp: this.buffer[this.buffer.length - 1]?.timestamp ?? 0,
      featureDim: RL_FEATURE_DIM,
      ema9: this.lastEma9,
      ema21: this.lastEma21,
      ema50: this.lastEma50,
      ema200: this.lastEma200,
      vwapDev: this.lastVwap > 0 && this.priceHistory.length > 0
        ? (this.priceHistory[this.priceHistory.length - 1] - this.lastVwap)
        : 0,
    };
  }

  reset(): void {
    this.buffer = [];
    this.tickCount = 0;
    this.priceHistory = [];
    this.volumeHistory = [];
    this.zNorm.reset();
    this.vwapNumerator = 0;
    this.vwapDenominator = 0;
    this.lastVwap = 0;
    this.lastEma9 = 0;
    this.lastEma21 = 0;
    this.lastEma50 = 0;
    this.lastEma200 = 0;
    this.prevEma9 = 0;
    this.ema9 = new TVEma({ period: 9, values: [] });
    this.ema21 = new TVEma({ period: 21, values: [] });
    this.ema50 = new TVEma({ period: 50, values: [] });
    this.ema200 = new TVEma({ period: 200, values: [] });
  }
}

export default RLDataCollector;
