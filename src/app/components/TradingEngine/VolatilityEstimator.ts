// src/tradingEngine/VolatilityEstimator.ts
import { MarketFeatures } from '@tradingEngine/types';

interface VolatilityForecast {
  current: number;
  forecast: number;
  regime: 'low' | 'normal' | 'high';
}

class VolatilityEstimator {
  private lambda: number = 0.94; // EWMA decay factor
  private volatilityCache: Map<string, number> = new Map();
  private returnsWindow!: Float32Array;
  private windowSize: number = 100;
  private currentIndex: number = 0;
  
  constructor() {
    this.returnsWindow = new Float32Array(this.windowSize);
  }
  
  estimateVolatility(features: MarketFeatures): number {
    // Fast EWMA calculation
    const currentReturn = this.extractReturn(features);
    this.returnsWindow[this.currentIndex] = currentReturn;
    this.currentIndex = (this.currentIndex + 1) % this.windowSize;
    
    // Calculate EWMA volatility
    let ewmaVariance = 0;
    let weight = 1;
    let weightSum = 0;
    
    for (let i = 0; i < this.windowSize; i++) {
      const idx = (this.currentIndex - i - 1 + this.windowSize) % this.windowSize;
      const ret = this.returnsWindow[idx];
      ewmaVariance += weight * ret * ret;
      weightSum += weight;
      weight *= this.lambda;
    }
    
    const volatility = Math.sqrt(ewmaVariance / weightSum);
    
    return volatility;
  }
  
  private extractReturn(features: MarketFeatures): number {
    // Uses the trendFilter from FeatureProcessor which is (currentPrice - prevPrice) / prevPrice
    // over a short window, providing a high-frequency return estimate.
    return features.trendFilter || 0;
  }
  
  private forecastVolatility(currentVol: number): number {
    // Simple AR(1) forecast with mean reversion
    const longTermMean = 0.02; // 2% daily vol
    const meanReversionSpeed = 0.1;
    return currentVol + meanReversionSpeed * (longTermMean - currentVol);
  }
  
  private determineRegime(volatility: number): 'low' | 'normal' | 'high' {
    if (volatility < 0.01) return 'low';
    if (volatility > 0.03) return 'high';
    return 'normal';
  }
}

export default VolatilityEstimator;