// src/tradingEngine/FeatureProcessor.ts
import { MarketFeatures, OrderBookData, OpenInterestData, OrderBookMicrostructure } from '@tradingEngine/types';
import Level2FeatureExtractor from './Level2FeatureExtractor';

class FeatureProcessor {
  private vwapWindow: number = 20;
  private trendWindow: number = 50;
  private priceHistory: number[] = [];
  private volumeHistory: number[] = [];
  private maxHistory: number = 100;
  private microExtractor: Level2FeatureExtractor;
  
  constructor() {
    this.priceHistory = [];
    this.volumeHistory = [];
    this.microExtractor = new Level2FeatureExtractor();
  }
  
  computeFeatures(
    orderBook: OrderBookData,
    openInterest: OpenInterestData,
    fundingRate: number
  ): MarketFeatures {
    const bids = new Float32Array(orderBook.bids.map((b: [string, string]) => parseFloat(b[0])));
    const bidVols = new Float32Array(orderBook.bids.map((b: [string, string]) => parseFloat(b[1])));
    const asks = new Float32Array(orderBook.asks.map((a: [string, string]) => parseFloat(a[0])));
    const askVols = new Float32Array(orderBook.asks.map((a: [string, string]) => parseFloat(a[1])));
    
    const midPrice = (bids[0] + asks[0]) / 2;
    this.updateHistory(midPrice, this.simdSum(bidVols) + this.simdSum(askVols));

    const microstructure = this.microExtractor.extractMicrostructure(orderBook);

    return {
      obi: this.calculateOBI(bidVols, askVols),
      oic: this.calculateOIC(openInterest),
      frd: fundingRate,
      vwapDev: this.calculateVWAPDeviation(bids, bidVols, asks, askVols),
      trendFilter: this.calculateTrendFilter(),
      microstructure
    };
  }

  private updateHistory(price: number, volume: number) {
    this.priceHistory.push(price);
    this.volumeHistory.push(volume);
    if (this.priceHistory.length > this.maxHistory) {
      this.priceHistory.shift();
      this.volumeHistory.shift();
    }
  }
  
  private calculateOBI(bidVols: Float32Array, askVols: Float32Array): number {
    const totalBidVol = this.simdSum(bidVols);
    const totalAskVol = this.simdSum(askVols);
    if (totalBidVol + totalAskVol === 0) return 0;
    return (totalBidVol - totalAskVol) / (totalBidVol + totalAskVol);
  }
  
  private calculateOIC(openInterest: OpenInterestData): number {
    return parseFloat(openInterest.openInterest);
  }
  
  private calculateVWAPDeviation(
    bids: Float32Array, 
    bidVols: Float32Array, 
    asks: Float32Array, 
    askVols: Float32Array
  ): number {
    const totalVolume = this.simdSum(bidVols) + this.simdSum(askVols);
    if (totalVolume === 0) return 0;
    
    const vwap = (this.simdWeightedSum(bids, bidVols) + this.simdWeightedSum(asks, askVols)) / totalVolume;
    const midPrice = (bids[0] + asks[0]) / 2;
    return (midPrice - vwap) / vwap;
  }
  
  private calculateTrendFilter(): number {
    if (this.priceHistory.length < 2) return 0;
    const current = this.priceHistory[this.priceHistory.length - 1];
    const prev = this.priceHistory[0];
    return (current - prev) / prev;
  }
  
  private simdSum(arr: Float32Array): number {
    // SIMD-optimized summation
    let sum = 0;
    const len = arr.length;
    const remainder = len % 4;
    const simdLen = len - remainder;
    
    // Process 4 elements at a time
    for (let i = 0; i < simdLen; i += 4) {
      sum += arr[i] + arr[i+1] + arr[i+2] + arr[i+3];
    }
    
    // Handle remainder
    for (let i = simdLen; i < len; i++) {
      sum += arr[i];
    }
    
    return sum;
  }
  
  private simdWeightedSum(values: Float32Array, weights: Float32Array): number {
    let sum = 0;
    const len = Math.min(values.length, weights.length);
    
    for (let i = 0; i < len; i++) {
      sum += values[i] * weights[i];
    }
    
    return sum;
  }
}

export default FeatureProcessor;