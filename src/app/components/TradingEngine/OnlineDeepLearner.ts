// src/tradingEngine/OnlineDeepLearner.ts
import * as tf from '@tensorflow/tfjs';
import { OrderBookMicrostructure, Experience, MultiHorizonPrediction } from '@tradingEngine/types';
import { ReplayBuffer } from '@tradingEngine/utils/buffers';

interface PredictionResult {
  direction: 'buy' | 'sell' | 'hold';
  confidence: number;
  expectedReturn?: number;
}

class OnlineDeepLearner {
  private instanceId: string;
  private model!: tf.LayersModel;
  private attentionModel!: tf.LayersModel;
  private attentionOutput!: tf.SymbolicTensor;
  private optimizer!: tf.Optimizer;
  private experienceReplay!: ReplayBuffer;
  private updateFrequency: number = 10;
  private updateCounter: number = 0;
  private isFitting: boolean = false;
  
  private featureHistory: number[][] = [];
  private targetHistory: number[] = [];
  private readonly correlationWindow: number = 100;
  
  private readonly featureNames = [
    'bid_ask_spread', 'order_flow_toxicity', 'price_impact',
    ...Array.from({ length: 10 }, (_, i) => `imbalance_l${i + 1}`),
    ...Array.from({ length: 10 }, (_, i) => `vol_prof_bid_l${i + 1}`),
    ...Array.from({ length: 10 }, (_, i) => `vol_prof_ask_l${i + 1}`),
    ...Array.from({ length: 17 }, (_, i) => `liq_depth_${i + 1}`)
  ];

  private lastMetrics = {
    loss: 0,
    accuracy: 0,
    gradientNorm: 0
  };

  private cachedCorrelations: Map<string, number> = new Map();
  private lastCorrelationUpdate: number = 0;
  
  constructor() {
    this.instanceId = Math.random().toString(36).slice(2, 8);
    this.optimizer = tf.train.adam(0.001);
    this.buildAdaptiveModel();
    this.experienceReplay = new ReplayBuffer(5000); // Small buffer for quick adaptation
  }

  private buildAdaptiveModel() {
    const pfx = `inst${this.instanceId}_`;
    const input = tf.input({ shape: [50], name: `${pfx}input` });
    
    // Normalize inputs for stability (use direct input to avoid layer registration issues)
    const normalized: tf.SymbolicTensor = input;
    
    // Apply attention mechanism using a sigmoid layer for feature weighting
    const attention: tf.SymbolicTensor = tf.layers.dense({
      name: `${pfx}attention`,
      units: 50,
      activation: 'sigmoid',
      kernelInitializer: 'glorotNormal'
    }).apply(normalized) as tf.SymbolicTensor;
    this.attentionOutput = attention;
    
    const attendedInput = tf.layers.multiply({ name: `${pfx}mul` }).apply([normalized, attention]) as tf.SymbolicTensor;

    const dense1 = tf.layers.dense({
      name: `${pfx}dense1`,
      units: 128,
      activation: 'relu',
      kernelInitializer: 'heNormal'
    }).apply(attendedInput);
    
    // Add Dropout for regularization instead of noise if data is stagnant
    const dropout1 = tf.layers.dropout({ name: `${pfx}drop1`, rate: 0.1 }).apply(dense1 as tf.SymbolicTensor);

    const dense2 = tf.layers.dense({
      name: `${pfx}dense2`,
      units: 64,
      activation: 'relu',
      kernelInitializer: 'heNormal'
    }).apply(dropout1 as tf.SymbolicTensor);
    
    // Multi-head output for different prediction horizons
    const output1ms = tf.layers.dense({
      name: `${pfx}out_1ms`,
      units: 5,
      activation: 'softmax'
    }).apply(dense2);
    
    const output10ms = tf.layers.dense({
      name: `${pfx}out_10ms`,
      units: 5,
      activation: 'softmax'
    }).apply(dense2);
    
    const output100ms = tf.layers.dense({
      name: `${pfx}out_100ms`,
      units: 5,
      activation: 'softmax'
    }).apply(dense2);
    
    this.model = tf.model({
      inputs: input,
      outputs: [output1ms, output10ms, output100ms] as tf.SymbolicTensor[]
    });

    this.model.compile({
      optimizer: this.optimizer,
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });

    // Pre-build attention model for performance and to avoid leaks
    this.attentionModel = tf.model({
      inputs: this.model.inputs,
      outputs: this.attentionOutput
    });
  }

  async incrementalUpdate(
    microstructure: OrderBookMicrostructure,
    actualPriceChange: number,
    learningRate: number
  ): Promise<void> {
    const features = this.microstructureToFeatures(microstructure);
    
    // Track history for correlation
    this.featureHistory.push(features);
    this.targetHistory.push(actualPriceChange);
    if (this.featureHistory.length > this.correlationWindow) {
      this.featureHistory.shift();
      this.targetHistory.shift();
    }

    // Store experience
    this.experienceReplay.add({
      state: features,
      action: this.priceChangeToClass(actualPriceChange),
      reward: 0, 
      nextState: features,
      done: false
    });
    
    this.updateCounter++;
    
    // Perform update every N samples
    if (this.updateCounter % this.updateFrequency === 0) {
      await this.performBatchUpdate(learningRate);
    }
  }

  public async trainOnBatch(learningRate: number): Promise<void> {
    await this.performBatchUpdate(learningRate);
  }

  private async performBatchUpdate(learningRate: number): Promise<void> {
    if (this.isFitting) return;
    
    const batchSize = 32;
    const batch = this.experienceReplay.sample(batchSize);
    if (batch.length < batchSize) {
      console.log(`DeepLearner: Waiting for more data to start training (${batch.length}/${batchSize})`);
      return;
    }
    
    this.isFitting = true;
    try {
      const { states, targets } = tf.tidy(() => {
        const rawStates = tf.tensor2d(batch.map(e => e.state));
        
        // Dynamic noise scaling based on batch variance to prevent collapse
        const std = tf.moments(rawStates).variance.sqrt();
        const noise = tf.randomNormal(rawStates.shape, 0, std.mul(0.01).dataSync()[0] || 0.01);
        const noisyStates = rawStates.add(noise);

        const rawTargets = tf.tensor2d(batch.map(e => {
          const target = [0, 0, 0, 0, 0];
          target[e.action] = 1;
          return target;
        }));
        
        const epsilon = 0.1;
        const smoothing = tf.scalar(epsilon / 5);
        const smoothedTargets = rawTargets.mul(1 - epsilon).add(smoothing);

        return { states: noisyStates, targets: smoothedTargets };
      });
      
      (this.optimizer as any).learningRate = learningRate;
      
      // Fixed class weights for multiple outputs
      const weightMap = {
        0: 5.0, // Strong Sell
        1: 3.0, // Sell
        2: 0.5, // Hold (reduced weight but not zero)
        3: 3.0, // Buy
        4: 5.0  // Strong Buy
      };

      const history = await this.model.fit(states, [targets, targets, targets], {
        epochs: 1,
        batchSize: batchSize,
        verbose: 0,
        classWeight: {
          'output_1ms': weightMap,
          'output_10ms': weightMap,
          'output_100ms': weightMap
        } as any
      });
      
      // Robust accuracy tracking
      const accKeys = Object.keys(history.history).filter(k => k.includes('acc') || k.includes('Accuracy'));
      const totalAcc = accKeys.reduce((sum, k) => sum + (history.history[k][0] as number), 0);
      const avgAcc = accKeys.length > 0 ? totalAcc / accKeys.length : 0;

      this.lastMetrics = {
        loss: history.history.loss[0] as number,
        accuracy: isNaN(avgAcc) ? 0 : avgAcc,
        gradientNorm: Math.sqrt(history.history.loss[0] as number) || 0
      };

      if (isNaN(this.lastMetrics.loss) || isNaN(this.lastMetrics.accuracy)) {
        console.error('DeepLearner: NaN detected in metrics', this.lastMetrics);
      }
      
      states.dispose();
      targets.dispose();
    } finally {
      this.isFitting = false;
    }
  }

  public async getWeightDistribution(): Promise<number[]> {
    const weights = this.model.getWeights();
    const allWeights: number[] = [];
    
    for (const w of weights) {
      const data = await w.data();
      allWeights.push(...Array.from(data));
    }
    
    // Subsample if too many weights for visualization
    if (allWeights.length > 500) {
      const step = Math.floor(allWeights.length / 500);
      return allWeights.filter((_, i) => i % step === 0).slice(0, 500);
    }
    
    return allWeights;
  }

  public getModelInfo() {
    const layers = this.model.layers;
    const nodeCounts = layers.map(l => {
      const config = l.getConfig();
      return (config as any).units || 0;
    }).filter(count => count > 0);
    
    return {
      totalNodes: nodeCounts.reduce((a, b) => a + b, 0),
      layerNodes: nodeCounts
    };
  }

  public getMetrics() {
    return {
      ...this.lastMetrics,
      sampleCount: this.experienceReplay.size()
    };
  }

  private async predictInternal(
    microstructure: OrderBookMicrostructure
  ): Promise<{ 
    features: tf.Tensor2D, 
    attentionWeights: tf.Tensor, 
    pred1ms: tf.Tensor, 
    pred10ms: tf.Tensor, 
    pred100ms: tf.Tensor 
  }> {
    const features = tf.tensor2d([this.microstructureToFeatures(microstructure)]);
    const attentionWeights = this.attentionModel.predict(features) as tf.Tensor;
    const [pred1ms, pred10ms, pred100ms] = this.model.predict(features) as tf.Tensor[];
    
    return { features, attentionWeights, pred1ms, pred10ms, pred100ms };
  }

  public async predict(
    microstructure: OrderBookMicrostructure
  ): Promise<MultiHorizonPrediction> {
    const { features, attentionWeights, pred1ms, pred10ms, pred100ms } = await this.predictInternal(microstructure);
    
    try {
      const [attentionData, probs1ms, probs10ms, probs100ms] = await Promise.all([
        attentionWeights.data(),
        pred1ms.data(),
        pred10ms.data(),
        pred100ms.data()
      ]);
      
      const featureImportance = new Map<string, number>();
      this.featureNames.forEach((name, i) => {
        featureImportance.set(name, attentionData[i] || 0);
      });

      // Throttle correlation calculation (e.g., every 50 predictions or every 5 seconds)
      const now = Date.now();
      if (this.cachedCorrelations.size === 0 || now - this.lastCorrelationUpdate > 5000) {
        this.cachedCorrelations = this.calculateCorrelations();
        this.lastCorrelationUpdate = now;
      }
      
      return {
        horizon1ms: this.decodePrediction(new Float32Array(probs1ms)),
        horizon10ms: this.decodePrediction(new Float32Array(probs10ms)),
        horizon100ms: this.decodePrediction(new Float32Array(probs100ms)),
        featureImportance,
        featureCorrelation: this.cachedCorrelations
      };
    } finally {
      tf.dispose([features, attentionWeights, pred1ms, pred10ms, pred100ms]);
    }
  }

  private calculateCorrelations(): Map<string, number> {
    const correlations = new Map<string, number>();

    if (this.featureHistory.length < 5) {
      // Return zero correlations during early warmup instead of empty map
      this.featureNames.forEach(name => correlations.set(name, 0));
      return correlations;
    }

    const n = this.featureHistory.length;
    const y = this.targetHistory;
    const yMean = y.reduce((a, b) => a + b, 0) / n;

    this.featureNames.forEach((name, i) => {
      const x = this.featureHistory.map(f => f[i]);
      const xMean = x.reduce((a, b) => a + b, 0) / n;
      
      let num = 0;
      let denX = 0;
      let denY = 0;
      
      for (let j = 0; j < n; j++) {
        const dx = x[j] - xMean;
        const dy = y[j] - yMean;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
      }
      
      const r = denX * denY === 0 ? 0 : num / Math.sqrt(denX * denY);
      correlations.set(name, r);
    });

    return correlations;
  }

  private microstructureToFeatures(microstructure: OrderBookMicrostructure): number[] {
    // Convert microstructure to 50-dimensional feature vector
    const features: number[] = [
      microstructure.bidAskSpread,
      microstructure.orderFlowToxicity,
      microstructure.priceImpact,
      ...microstructure.orderImbalance,
      ...Array.from(microstructure.volumeProfile),
      ...microstructure.liquidityDepth.slice(0, 17)
    ];
    
    // Pad or truncate to 50 features
    while (features.length < 50) {
      features.push(0);
    }
    
    return features.slice(0, 50);
  }

  private priceChangeToClass(priceChange: number): number {
    // Handle NaN or invalid input
    if (isNaN(priceChange) || !isFinite(priceChange)) return 2; // Default to Hold

    // Dynamically adjust sensitivity for high-frequency updates
    const absChange = Math.abs(priceChange);
    
    // Very sensitive thresholds for micro-moves (e.g., $1-2 move on BTC)
    if (priceChange < -0.0001) return 0; // Strong sell (0.01%+)
    if (priceChange < -0.00002) return 1; // Sell (0.002%+)
    if (absChange <= 0.00002) return 2;   // Hold
    if (priceChange < 0.0001) return 3;  // Buy (0.002%+)
    return 4; // Strong buy (0.01%+)
  }

  private decodePrediction(probs: Float32Array): PredictionResult {
    let maxIndex = 2; // Default to Hold
    let maxValue = probs[2];
    
    // Check for NaN and recover
    const hasNaN = Array.from(probs).some(p => isNaN(p));
    if (hasNaN) {
      return { direction: 'hold', confidence: 0.5, expectedReturn: 0 };
    }

    // Find most likely direction
    for (let i = 0; i < probs.length; i++) {
      if (probs[i] > maxValue) {
        maxValue = probs[i];
        maxIndex = i;
      }
    }
    
    const directions = ['sell', 'sell', 'hold', 'buy', 'buy'] as const;
    const direction = directions[maxIndex] || 'hold';

    // Net directional probability
    const buyProb = (probs[3] || 0) + (probs[4] || 0);
    const sellProb = (probs[0] || 0) + (probs[1] || 0);
    // bias in [-1, 1]: positive = buy leaning, negative = sell leaning
    const totalDirectional = buyProb + sellProb;
    const bias = totalDirectional > 0.01 ? (buyProb - sellProb) / totalDirectional : 0;

    // Override direction only if the model is uncertain (hold) but has a clear lean
    let finalDirection = direction;
    if (direction === 'hold' && Math.abs(bias) > 0.15) {
      finalDirection = bias > 0 ? 'buy' : 'sell';
    }

    return {
      direction: finalDirection,
      confidence: Math.min(0.9999, maxValue || 0.2),
      expectedReturn: (maxIndex - 2) * 0.005
    };
  }
}

export default OnlineDeepLearner;