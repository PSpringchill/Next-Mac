// src/tradingEngine/AdaptiveMarketLearner.ts
import * as tf from '@tensorflow/tfjs';
import { EventEmitter } from 'events';
import { 
  MarketFeatures, 
  MarketRegime, 
  MarketStatePrediction, 
  MultiHorizonPrediction, 
  OrderBookData, 
  OpenInterestData,
  OrderBookMicrostructure 
} from '@tradingEngine/types';
import MarkovChainPredictor from './MarkovChainPredictor';
import OnlineDeepLearner from './OnlineDeepLearner';
import Level2FeatureExtractor from './Level2FeatureExtractor';
import HiddenMarkovModel from './HiddenMarkovModel';
import { ShortTermMemory } from '@tradingEngine/utils/buffers';

interface MarketPrediction {
  regime: MarketRegime;
  confidence: number;
  timeHorizon: number;
  expectedMove?: number;
}

class AdaptiveMarketLearner extends EventEmitter {
  private markovChain: MarkovChainPredictor;
  private onlineLearner: OnlineDeepLearner;
  private featureExtractor: Level2FeatureExtractor;
  private regimeDetector: HiddenMarkovModel;
  private memoryBuffer: ShortTermMemory;
  private adaptiveRate: number = 0.01;
  private lastMicrostructure: OrderBookMicrostructure | null = null;
  
  constructor() {
    super();
    this.markovChain = new MarkovChainPredictor();
    this.onlineLearner = new OnlineDeepLearner();
    this.featureExtractor = new Level2FeatureExtractor();
    this.regimeDetector = new HiddenMarkovModel();
    this.memoryBuffer = new ShortTermMemory(1000); // Short window for quick adaptation
  }

  async train(trainingData: any[], epoch: number): Promise<any> {
    const metricsBefore = this.onlineLearner.getMetrics();
    
    // Perform batch training on existing memory
    await this.onlineLearner.trainOnBatch(this.adaptiveRate);

    const metricsAfter = this.onlineLearner.getMetrics();
    
    // Check if training actually occurred (loss changed or accuracy > 0)
    const trainingOccurred = metricsAfter.loss !== 0 || metricsAfter.accuracy > 0;
    
    const result = {
      loss: metricsAfter.loss,
      accuracy: metricsAfter.accuracy,
      learningRate: this.adaptiveRate,
      gradientNorm: metricsAfter.gradientNorm,
      rewards: 0,
      skipped: !trainingOccurred
    };
    
    if (trainingOccurred) {
      this.emit('training_step', { epoch, ...result });
    } else {
      // Emit a heartbeat or status update instead of a full training step
      this.emit('training_status', { 
        epoch, 
        message: `Warming up... (${metricsAfter.sampleCount}/32 samples)`,
        sampleCount: metricsAfter.sampleCount
      });
    }
    
    return result;
  }

  async getFeatureImportance(): Promise<Map<string, number>> {
    if (!this.lastMicrostructure) {
      return new Map();
    }
    const mlPrediction = await this.onlineLearner.predict(this.lastMicrostructure);
    return mlPrediction.featureImportance || new Map();
  }

  async learnFromLevel2Data(
    orderBook: OrderBookData,
    priceChange: number,
    timeWindow: number = 100 // milliseconds
  ): Promise<MarketPrediction> {
    // Extract Level 2 microstructure features
    const microstructure = this.featureExtractor.extractMicrostructure(orderBook);
    this.lastMicrostructure = microstructure;
    
    // Detect current market regime
    const regime = await this.regimeDetector.detectRegime(microstructure, priceChange);
    this.currentRegime = regime;
    
    // Update Markov chain with new state transition
    this.markovChain.updateTransition(microstructure, priceChange);
    
    // Online learning - adapt to new patterns immediately
    await this.onlineLearner.incrementalUpdate(
      microstructure,
      priceChange,
      this.getAdaptiveLearningRate(regime)
    );
    
    // Calculate feature importance in real-time
    const featureImportance = await this.calculateFeatureImportance(
      microstructure,
      priceChange
    );
    
    // Generate prediction using ensemble
    const prediction = await this.generatePrediction(
      microstructure,
      regime,
      featureImportance
    );

    // Emit detailed prediction event for logging
    this.emit('prediction', {
      features: microstructure,
      actualPriceMove: priceChange,
      prediction: prediction.expectedMove,
      marketRegime: regime.name,
      orderBookState: {
        spread: microstructure.bidAskSpread,
        imbalance: microstructure.orderImbalance[0],
        liquidityDepth: microstructure.liquidityDepth[0],
        volumeSkew: microstructure.volumeProfile[0]
      }
    });

    // Emit performance update for logging
    const metrics = this.onlineLearner.getMetrics();
    this.emit('performance_update', {
      winRate: metrics.accuracy, // Approximation
      sharpeRatio: 0, // Would need trade history
      maxDrawdown: 0,
      totalReturn: 0,
      trades: this.memoryBuffer.size()
    });

    return prediction;
  }

  private getAdaptiveLearningRate(regime: MarketRegime): number {
    // Higher learning rate for regime changes (algorithm changes)
    if (regime.isTransition) {
      return this.adaptiveRate * 10; // Learn 10x faster during transitions
    }
    return this.adaptiveRate * (1 + regime.volatility);
  }

  private quantizeMarketState(microstructure: OrderBookMicrostructure): number[] {
    return [
      Math.round(microstructure.bidAskSpread * 10000),
      Math.round(microstructure.orderFlowToxicity * 100),
      Math.round(microstructure.priceImpact * 1000)
    ];
  }

  private async calculateFeatureImportance(
    microstructure: OrderBookMicrostructure,
    priceChange: number
  ): Promise<Map<string, number>> {
    const prediction = await this.onlineLearner.predict(microstructure);
    return prediction.featureImportance || new Map();
  }

  private async generatePrediction(
    microstructure: OrderBookMicrostructure,
    regime: MarketRegime,
    featureImportance: Map<string, number>
  ): Promise<MarketPrediction> {
    const mlPrediction = await this.onlineLearner.predict(microstructure);
    const horizon1ms = mlPrediction.horizon1ms;
    
    const expectedMove = horizon1ms.expectedReturn || 0;
    
    return {
      regime,
      confidence: horizon1ms.confidence,
      timeHorizon: 100,
      expectedMove
    };
  }

  async predictMarketState(): Promise<MarketStatePrediction> {
    if (!this.lastMicrostructure) {
      return {
        mostLikelyState: 'unknown',
        probability: 0,
        expectedPriceMove: 0,
        stateDistribution: {},
        confidence: 0
      };
    }
    return this.markovChain.predictNextState(this.lastMicrostructure);
  }

  async predictMultiHorizon(): Promise<MultiHorizonPrediction> {
    if (!this.lastMicrostructure) {
      return {
        horizon1ms: { direction: 'hold', confidence: 0 },
        horizon10ms: { direction: 'hold', confidence: 0 },
        horizon100ms: { direction: 'hold', confidence: 0 },
        featureImportance: new Map(),
        featureCorrelation: new Map()
      };
    }
    return this.onlineLearner.predict(this.lastMicrostructure);
  }

  private currentRegime: MarketRegime = {
    name: 'unknown',
    volatility: 0.02,
    momentum: 0.5,
    isTransition: false
  };

  async getWeightDistribution(): Promise<number[]> {
    return this.onlineLearner.getWeightDistribution();
  }

  getModelInfo() {
    return this.onlineLearner.getModelInfo();
  }

  public getMetrics() {
    return {
      ...this.onlineLearner.getMetrics(),
      adaptiveLearningRate: this.getAdaptiveLearningRate(this.currentRegime)
    };
  }

  getCurrentRegime(): MarketRegime {
    return this.currentRegime;
  }

  updateRegime(regime: MarketRegime): void {
    this.currentRegime = regime;
  }
}

export default AdaptiveMarketLearner;