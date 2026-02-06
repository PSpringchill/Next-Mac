import * as tf from '@tensorflow/tfjs';
import { MarketFeatures, TradingSignal, OrderBookData, OpenInterestData } from '@tradingEngine/types';
import A3CAgent from './A3CAgent';
import DDPGAgent from './DDPGAgent';
import FeatureProcessor from './FeatureProcessor';
import VolatilityEstimator from './VolatilityEstimator';

class TradingEngine {
  private a3cModel: A3CAgent;
  private ddpgModel: DDPGAgent;
  private featureProcessor: FeatureProcessor;
  private volatilityEstimator: VolatilityEstimator;
  
  constructor() {
    this.a3cModel = new A3CAgent();
    this.ddpgModel = new DDPGAgent();
    this.featureProcessor = new FeatureProcessor();
    this.volatilityEstimator = new VolatilityEstimator();
  }

  async processMarketData(
    orderBook: OrderBookData,
    openInterest: OpenInterestData,
    fundingRate: number
  ): Promise<TradingSignal> {
    // Compute features using vectorized operations
    const features = await this.featureProcessor.computeFeatures(
      orderBook,
      openInterest,
      fundingRate
    );
    
    // Get volatility forecast
    const volatility = this.volatilityEstimator.estimateVolatility(features);
    
    // Run parallel predictions
    const [a3cSignal, ddpgSignal] = await Promise.all([
      this.a3cModel.predict(features),
      this.ddpgModel.predict(features)
    ]);
    
    // Ensemble decision
    return this.ensembleDecision(a3cSignal, ddpgSignal, volatility);
  }

  private ensembleDecision(
    a3cSignal: TradingSignal,
    ddpgSignal: TradingSignal,
    volatility: number
  ): TradingSignal {
    // Simple ensemble: weighted average with volatility adjustment
    const weight = 1 / (1 + volatility);
    const direction = (a3cSignal.direction * weight + ddpgSignal.direction * (1 - weight));
    const strength = (a3cSignal.strength * weight + ddpgSignal.strength * (1 - weight));
    const confidence = (a3cSignal.confidence * weight + ddpgSignal.confidence * (1 - weight));

    return {
      direction,
      strength,
      confidence,
      timestamp: Date.now(),
      metadata: {
        a3cSignal,
        ddpgSignal,
        volatility
      }
    };
  }
}

export default TradingEngine;