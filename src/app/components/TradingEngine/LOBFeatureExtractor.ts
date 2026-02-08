// src/tradingEngine/LOBFeatureExtractor.ts
// Limit Order Book Feature Extractor for ML-based trading strategy
// Extracts: Depth Ratio, Rise Ratio, EMA 4/8/12 Cross, Spread, OBI, Volume Profile

import { OrderBookData, OrderLevel } from '@tradingEngine/types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LOBSnapshot {
  timestamp: number;
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  spread: number;
  bids: OrderLevel[];
  asks: OrderLevel[];
}

export interface LOBFeatures {
  // Core LOB features
  midPrice: number;
  spread: number;
  spreadBps: number;

  // Depth Ratio at multiple levels
  depthRatio1: number;   // Level 1
  depthRatio5: number;   // Top 5 levels
  depthRatio10: number;  // Top 10 levels
  depthRatioFull: number;

  // Rise Ratio (price momentum from LOB)
  riseRatio: number;
  riseRatioWeighted: number;

  // EMA Cross features
  ema4: number;
  ema8: number;
  ema12: number;
  emaCross4_8: number;    // EMA4 - EMA8 (positive = bullish cross)
  emaCross4_12: number;   // EMA4 - EMA12
  emaCross8_12: number;   // EMA8 - EMA12
  emaCrossSignal: -1 | 0 | 1;  // -1 bearish, 0 neutral, 1 bullish

  // Order Book Imbalance
  obi: number;
  obiWeighted: number;

  // Volume Profile
  bidVolume: number;
  askVolume: number;
  volumeImbalance: number;

  // Microstructure
  bidAskSpread: number;
  orderFlowToxicity: number;
  liquidityScore: number;

  // Derived signals
  label: 0 | 1;  // 0 = down/flat, 1 = up (for classifier target)
  timestamp: number;
}

export interface EMAState {
  ema4: number;
  ema8: number;
  ema12: number;
  initialized: boolean;
}

// ─── LOB Feature Extractor ───────────────────────────────────────────────────

class LOBFeatureExtractor {
  private snapshotHistory: LOBSnapshot[] = [];
  private maxHistory: number;
  private emaState: EMAState = { ema4: 0, ema8: 0, ema12: 0, initialized: false };
  private priceHistory: number[] = [];
  private labelLookAheadMs: number;  // 10 seconds default

  constructor(maxHistory: number = 2000, labelLookAheadMs: number = 10_000) {
    this.maxHistory = maxHistory;
    this.labelLookAheadMs = labelLookAheadMs;
  }

  // ─── Main extraction entry point ──────────────────────────────────────────

  extract(orderBook: OrderBookData, timestamp: number = Date.now()): LOBFeatures {
    const bids = this.parseOrders(orderBook.bids);
    const asks = this.parseOrders(orderBook.asks);

    if (bids.length === 0 || asks.length === 0) {
      return this.emptyFeatures(timestamp);
    }

    const bestBid = bids[0].price;
    const bestAsk = asks[0].price;
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;

    // Store snapshot
    const snapshot: LOBSnapshot = { timestamp, bestBid, bestAsk, midPrice, spread, bids, asks };
    this.addSnapshot(snapshot);

    // Update EMAs
    this.updateEMA(midPrice);
    this.priceHistory.push(midPrice);
    if (this.priceHistory.length > this.maxHistory) this.priceHistory.shift();

    // Compute all features
    const depthRatios = this.computeDepthRatios(bids, asks);
    const riseRatios = this.computeRiseRatio(bids, asks);
    const emaCross = this.computeEMACross();
    const obi = this.computeOBI(bids, asks);
    const volumeProfile = this.computeVolumeProfile(bids, asks);
    const microstructure = this.computeMicrostructure(bids, asks, spread);

    return {
      midPrice,
      spread,
      spreadBps: midPrice > 0 ? (spread / midPrice) * 10000 : 0,

      ...depthRatios,
      ...riseRatios,
      ...emaCross,
      ...obi,
      ...volumeProfile,
      ...microstructure,

      label: 0,  // Label is assigned retroactively by assignLabels()
      timestamp,
    };
  }

  // ─── Depth Ratio ──────────────────────────────────────────────────────────
  // Depth Ratio = bidVolume / (bidVolume + askVolume) at N levels
  // > 0.5 means more buying pressure, < 0.5 means more selling pressure

  private computeDepthRatios(bids: OrderLevel[], asks: OrderLevel[]) {
    const depthAt = (n: number) => {
      const bidVol = bids.slice(0, n).reduce((s, b) => s + b.volume, 0);
      const askVol = asks.slice(0, n).reduce((s, a) => s + a.volume, 0);
      const total = bidVol + askVol;
      return total > 0 ? bidVol / total : 0.5;
    };

    const bidVolFull = bids.reduce((s, b) => s + b.volume, 0);
    const askVolFull = asks.reduce((s, a) => s + a.volume, 0);
    const totalFull = bidVolFull + askVolFull;

    return {
      depthRatio1: depthAt(1),
      depthRatio5: depthAt(5),
      depthRatio10: depthAt(10),
      depthRatioFull: totalFull > 0 ? bidVolFull / totalFull : 0.5,
    };
  }

  // ─── Rise Ratio ───────────────────────────────────────────────────────────
  // Rise Ratio measures the directional pressure based on the shape of the LOB.
  // It's the ratio of rising ask prices vs falling bid prices, weighted by volume.
  // Higher = more upward pressure (asks thinning out → price likely to rise)

  private computeRiseRatio(bids: OrderLevel[], asks: OrderLevel[]) {
    const levels = Math.min(10, bids.length, asks.length);
    if (levels < 2) return { riseRatio: 0.5, riseRatioWeighted: 0.5 };

    // Rise ratio: compare volume distribution asymmetry
    // Thin asks + thick bids = price likely to rise
    let bidCumVol = 0;
    let askCumVol = 0;
    let weightedBidSum = 0;
    let weightedAskSum = 0;

    for (let i = 0; i < levels; i++) {
      const weight = 1 / (1 + i * 0.2);  // Decay weight by level distance
      bidCumVol += bids[i].volume;
      askCumVol += asks[i].volume;
      weightedBidSum += bids[i].volume * weight;
      weightedAskSum += asks[i].volume * weight;
    }

    const totalVol = bidCumVol + askCumVol;
    const totalWeighted = weightedBidSum + weightedAskSum;

    // Rise ratio: bid support vs ask resistance
    // If bids are heavier → more support → price rises → riseRatio > 0.5
    const riseRatio = totalVol > 0 ? bidCumVol / totalVol : 0.5;
    const riseRatioWeighted = totalWeighted > 0 ? weightedBidSum / totalWeighted : 0.5;

    return { riseRatio, riseRatioWeighted };
  }

  // ─── EMA 4/8/12 Cross ────────────────────────────────────────────────────
  // Classic EMA cross strategy: compute EMA(4), EMA(8), EMA(12) of mid-prices
  // Cross signals: EMA4 > EMA8 > EMA12 = bullish, reverse = bearish

  private updateEMA(price: number): void {
    if (!this.emaState.initialized) {
      this.emaState = { ema4: price, ema8: price, ema12: price, initialized: true };
      return;
    }

    // EMA multiplier: 2 / (period + 1)
    const alpha4 = 2 / (4 + 1);
    const alpha8 = 2 / (8 + 1);
    const alpha12 = 2 / (12 + 1);

    this.emaState.ema4 = price * alpha4 + this.emaState.ema4 * (1 - alpha4);
    this.emaState.ema8 = price * alpha8 + this.emaState.ema8 * (1 - alpha8);
    this.emaState.ema12 = price * alpha12 + this.emaState.ema12 * (1 - alpha12);
  }

  private computeEMACross() {
    const { ema4, ema8, ema12 } = this.emaState;
    const cross4_8 = ema4 - ema8;
    const cross4_12 = ema4 - ema12;
    const cross8_12 = ema8 - ema12;

    // Determine cross signal
    let emaCrossSignal: -1 | 0 | 1 = 0;
    if (cross4_8 > 0 && cross4_12 > 0 && cross8_12 > 0) {
      emaCrossSignal = 1;  // Full bullish alignment
    } else if (cross4_8 < 0 && cross4_12 < 0 && cross8_12 < 0) {
      emaCrossSignal = -1; // Full bearish alignment
    }

    return {
      ema4,
      ema8,
      ema12,
      emaCross4_8: cross4_8,
      emaCross4_12: cross4_12,
      emaCross8_12: cross8_12,
      emaCrossSignal,
    };
  }

  // ─── Order Book Imbalance ─────────────────────────────────────────────────

  private computeOBI(bids: OrderLevel[], asks: OrderLevel[]) {
    const levels = Math.min(10, bids.length, asks.length);
    let bidVol = 0;
    let askVol = 0;
    let weightedBidVol = 0;
    let weightedAskVol = 0;

    for (let i = 0; i < levels; i++) {
      const weight = 1 / (1 + i);
      bidVol += bids[i].volume;
      askVol += asks[i].volume;
      weightedBidVol += bids[i].volume * weight;
      weightedAskVol += asks[i].volume * weight;
    }

    const total = bidVol + askVol;
    const totalWeighted = weightedBidVol + weightedAskVol;

    return {
      obi: total > 0 ? (bidVol - askVol) / total : 0,
      obiWeighted: totalWeighted > 0 ? (weightedBidVol - weightedAskVol) / totalWeighted : 0,
    };
  }

  // ─── Volume Profile ───────────────────────────────────────────────────────

  private computeVolumeProfile(bids: OrderLevel[], asks: OrderLevel[]) {
    const bidVolume = bids.reduce((s, b) => s + b.volume, 0);
    const askVolume = asks.reduce((s, a) => s + a.volume, 0);
    const total = bidVolume + askVolume;

    return {
      bidVolume,
      askVolume,
      volumeImbalance: total > 0 ? (bidVolume - askVolume) / total : 0,
    };
  }

  // ─── Microstructure ───────────────────────────────────────────────────────

  private computeMicrostructure(bids: OrderLevel[], asks: OrderLevel[], spread: number) {
    // Order flow toxicity (VPIN approximation)
    const bidVol = bids.reduce((s, b) => s + b.volume, 0);
    const askVol = asks.reduce((s, a) => s + a.volume, 0);
    const total = bidVol + askVol;
    const orderFlowToxicity = total > 0 ? Math.abs(bidVol - askVol) / total : 0;

    // Liquidity score: how much volume near the top of book
    const top3BidVol = bids.slice(0, 3).reduce((s, b) => s + b.volume, 0);
    const top3AskVol = asks.slice(0, 3).reduce((s, a) => s + a.volume, 0);
    const liquidityScore = top3BidVol + top3AskVol;

    return {
      bidAskSpread: spread,
      orderFlowToxicity,
      liquidityScore,
    };
  }

  // ─── Label Assignment (for supervised learning) ───────────────────────────
  // Assigns labels retroactively: 1 if price rose after labelLookAheadMs, 0 otherwise

  assignLabels(features: LOBFeatures[]): LOBFeatures[] {
    if (features.length < 2) return features;

    const labeled = [...features];
    for (let i = 0; i < labeled.length; i++) {
      const currentPrice = labeled[i].midPrice;
      // Find the feature closest to labelLookAheadMs in the future
      let futureIdx = i + 1;
      while (
        futureIdx < labeled.length &&
        labeled[futureIdx].timestamp - labeled[i].timestamp < this.labelLookAheadMs
      ) {
        futureIdx++;
      }

      if (futureIdx < labeled.length) {
        labeled[i].label = labeled[futureIdx].midPrice > currentPrice ? 1 : 0;
      } else {
        // No future data available — keep as 0
        labeled[i].label = 0;
      }
    }

    return labeled;
  }

  // ─── Feature Vector for ML Models ─────────────────────────────────────────
  // Returns a flat numeric array suitable for classifier input

  toFeatureVector(features: LOBFeatures): number[] {
    return [
      features.spreadBps,
      features.depthRatio1,
      features.depthRatio5,
      features.depthRatio10,
      features.depthRatioFull,
      features.riseRatio,
      features.riseRatioWeighted,
      features.emaCross4_8,
      features.emaCross4_12,
      features.emaCross8_12,
      features.emaCrossSignal,
      features.obi,
      features.obiWeighted,
      features.volumeImbalance,
      features.orderFlowToxicity,
      features.liquidityScore,
    ];
  }

  static featureNames(): string[] {
    return [
      'spreadBps',
      'depthRatio1',
      'depthRatio5',
      'depthRatio10',
      'depthRatioFull',
      'riseRatio',
      'riseRatioWeighted',
      'emaCross4_8',
      'emaCross4_12',
      'emaCross8_12',
      'emaCrossSignal',
      'obi',
      'obiWeighted',
      'volumeImbalance',
      'orderFlowToxicity',
      'liquidityScore',
    ];
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  private parseOrders(orders: [string, string][]): OrderLevel[] {
    return orders.map(([price, volume]) => ({
      price: parseFloat(price),
      volume: parseFloat(volume),
    }));
  }

  private addSnapshot(snapshot: LOBSnapshot): void {
    this.snapshotHistory.push(snapshot);
    if (this.snapshotHistory.length > this.maxHistory) {
      this.snapshotHistory.shift();
    }
  }

  private emptyFeatures(timestamp: number): LOBFeatures {
    return {
      midPrice: 0, spread: 0, spreadBps: 0,
      depthRatio1: 0.5, depthRatio5: 0.5, depthRatio10: 0.5, depthRatioFull: 0.5,
      riseRatio: 0.5, riseRatioWeighted: 0.5,
      ema4: 0, ema8: 0, ema12: 0,
      emaCross4_8: 0, emaCross4_12: 0, emaCross8_12: 0, emaCrossSignal: 0,
      obi: 0, obiWeighted: 0,
      bidVolume: 0, askVolume: 0, volumeImbalance: 0,
      bidAskSpread: 0, orderFlowToxicity: 0, liquidityScore: 0,
      label: 0, timestamp,
    };
  }

  getSnapshotHistory(): LOBSnapshot[] {
    return [...this.snapshotHistory];
  }

  getEMAState(): EMAState {
    return { ...this.emaState };
  }

  getPriceHistory(): number[] {
    return [...this.priceHistory];
  }

  reset(): void {
    this.snapshotHistory = [];
    this.priceHistory = [];
    this.emaState = { ema4: 0, ema8: 0, ema12: 0, initialized: false };
  }
}

export default LOBFeatureExtractor;
