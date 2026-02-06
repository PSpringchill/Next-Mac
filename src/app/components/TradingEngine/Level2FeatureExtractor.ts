// src/tradingEngine/Level2FeatureExtractor.ts
import { CircularBuffer } from '@tradingEngine/utils/buffers';
import { OrderBookData, OrderBookMicrostructure, OrderLevel } from '@tradingEngine/types';

interface OrderBookSnapshot {
  timestamp: number;
  bids: OrderLevel[];
  asks: OrderLevel[];
}

class Level2FeatureExtractor {
  private orderBookHistory!: CircularBuffer<OrderBookSnapshot>;
  private tickSize: number = 0.01;
  
  constructor() {
    this.orderBookHistory = new CircularBuffer(1000);
  }
  
  extractMicrostructure(orderBook: OrderBookData): OrderBookMicrostructure {
    const bids = this.parseOrderBook(orderBook.bids);
    const asks = this.parseOrderBook(orderBook.asks);
    
    return {
      bidAskSpread: this.calculateSpread(bids, asks),
      orderImbalance: this.calculateMultiLevelImbalance(bids, asks),
      volumeProfile: this.calculateVolumeProfile(bids, asks),
      orderFlowToxicity: this.calculatePINModel(bids, asks),
      liquidityDepth: this.calculateLiquidityAtLevels(bids, asks),
      priceImpact: this.calculateKyleeLambda(bids, asks)
    };
  }

  private parseOrderBook(orderBook: [string, string][]): OrderLevel[] {
    return orderBook.map(([price, volume]) => ({
      price: parseFloat(price),
      volume: parseFloat(volume)
    }));
  }

  private calculateSpread(bids: OrderLevel[], asks: OrderLevel[]): number {
    if (bids.length === 0 || asks.length === 0) return 0;
    return asks[0].price - bids[0].price;
  }

  private calculateLiquidityAtLevels(
    bids: OrderLevel[],
    asks: OrderLevel[]
  ): number[] {
    const levels = 10;
    const liquidity: number[] = [];
    
    for (let i = 0; i < levels; i++) {
      const bidDepth = bids.slice(0, i + 1).reduce((sum, bid) => sum + bid.volume, 0);
      const askDepth = asks.slice(0, i + 1).reduce((sum, ask) => sum + ask.volume, 0);
      liquidity.push(bidDepth, askDepth);
    }
    
    return liquidity;
  }

  private calculateMultiLevelImbalance(
    bids: OrderLevel[],
    asks: OrderLevel[]
  ): number[] {
    // Calculate imbalance at multiple price levels
    const levels = 10;
    const imbalances = new Float32Array(levels);
    
    for (let i = 0; i < levels; i++) {
      const bidVol = bids[i]?.volume || 0;
      const askVol = asks[i]?.volume || 0;
      
      // Weighted by distance from mid-price
      const weight = 1 / (1 + i * 0.1);
      imbalances[i] = weight * (bidVol - askVol) / (bidVol + askVol + 1e-8);
    }
    
    return Array.from(imbalances);
  }

  private calculatePINModel(
    bids: OrderLevel[],
    asks: OrderLevel[]
  ): number {
    // Probability of Informed Trading (PIN) model
    const totalBidVol = bids.reduce((sum, b) => sum + b.volume, 0);
    const totalAskVol = asks.reduce((sum, a) => sum + a.volume, 0);
    
    // Estimate order flow toxicity
    const orderImbalance = Math.abs(totalBidVol - totalAskVol);
    const totalVolume = totalBidVol + totalAskVol;
    
    // VPIN approximation
    const vpin = orderImbalance / (totalVolume + 1e-8);
    
    // Adjust for order concentration
    const bidConcentration = this.calculateHerfindahlIndex(bids);
    const askConcentration = this.calculateHerfindahlIndex(asks);
    
    return vpin * (1 + (bidConcentration + askConcentration) / 2);
  }

  private calculateKyleeLambda(
    bids: OrderLevel[],
    asks: OrderLevel[]
  ): number {
    if (bids.length < 5 || asks.length < 5) return 0;
    
    // Kyle's Lambda - price impact coefficient
    const totalDepth = this.calculateTotalDepth(bids, asks, 5);
    
    // Estimate price impact per unit volume
    const priceRange = asks[4].price - bids[4].price;
    return priceRange / (totalDepth + 1e-8);
  }

  private calculateVolumeProfile(
    bids: OrderLevel[],
    asks: OrderLevel[]
  ): Float32Array {
    // Create volume profile across price levels
    const profile = new Float32Array(20);
    
    for (let i = 0; i < 10; i++) {
      profile[i] = bids[i]?.volume || 0;
      profile[10 + i] = asks[i]?.volume || 0;
    }
    
    // Normalize
    let maxVol = 0;
    for (let i = 0; i < profile.length; i++) {
      if (profile[i] > maxVol) maxVol = profile[i];
    }
    
    if (maxVol > 0) {
      for (let i = 0; i < profile.length; i++) {
        profile[i] /= maxVol;
      }
    }
    
    return profile;
  }

  private calculateTotalDepth(
    bids: OrderLevel[],
    asks: OrderLevel[],
    levels: number = 5
  ): number {
    let totalDepth = 0;
    
    for (let i = 0; i < Math.min(levels, bids.length); i++) {
      totalDepth += bids[i].volume;
    }
    
    for (let i = 0; i < Math.min(levels, asks.length); i++) {
      totalDepth += asks[i].volume;
    }
    
    return totalDepth;
  }

  private calculateHerfindahlIndex(levels: OrderLevel[]): number {
    const totalVolume = levels.reduce((sum, level) => sum + level.volume, 0);
    
    if (totalVolume === 0) return 0;
    
    let herfindahl = 0;
    for (const level of levels) {
      const marketShare = level.volume / totalVolume;
      herfindahl += marketShare * marketShare;
    }
    
    return herfindahl;
  }
}

export default Level2FeatureExtractor;