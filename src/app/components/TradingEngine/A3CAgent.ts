import * as tf from '@tensorflow/tfjs';
import { MarketFeatures, Experience, TradingSignal } from '@tradingEngine/types';

interface TradingAction {
  action: number;
  probability: number;
}

// src/tradingEngine/A3CAgent.ts
class A3CAgent {
  private actorModel!: tf.LayersModel;
  private criticModel!: tf.LayersModel;
  private optimizer!: tf.Optimizer;
  private gamma: number = 0.99;
  private entropy_beta: number = 0.01;
  
  constructor() {
    this.optimizer = tf.train.adam(0.0001);
    this.buildModels();
  }
  
  private buildModels() {
    // Actor network
    const actorInput = tf.input({ shape: [50] });
    const actorHidden1 = tf.layers.dense({
      units: 256,
      activation: 'relu',
      kernelInitializer: 'heNormal'
    }).apply(actorInput);
    
    const actorHidden2 = tf.layers.dense({
      units: 128,
      activation: 'relu'
    }).apply(actorHidden1);
    
    const policyOutput = tf.layers.dense({
      units: 3, // Buy, Hold, Sell
      activation: 'softmax'
    }).apply(actorHidden2);
    
    this.actorModel = tf.model({
      inputs: actorInput,
      outputs: policyOutput as tf.SymbolicTensor
    });
    
    this.actorModel.compile({
      optimizer: this.optimizer,
      loss: 'categoricalCrossentropy'
    });
    
    // Critic network
    const criticInput = tf.input({ shape: [50] });
    const criticHidden1 = tf.layers.dense({
      units: 256,
      activation: 'relu'
    }).apply(criticInput);
    
    const criticHidden2 = tf.layers.dense({
      units: 128,
      activation: 'relu'
    }).apply(criticHidden1);
    
    const valueOutput = tf.layers.dense({
      units: 1
    }).apply(criticHidden2);
    
    this.criticModel = tf.model({
      inputs: criticInput,
      outputs: valueOutput as tf.SymbolicTensor
    });

    this.criticModel.compile({
      optimizer: this.optimizer,
      loss: 'meanSquaredError'
    });
  }
  
  async predict(features: MarketFeatures): Promise<TradingSignal> {
    const input = tf.tensor2d([this.featuresToArray(features)]);
    const actionProbs = this.actorModel.predict(input) as tf.Tensor;
    const action = await this.sampleAction(actionProbs);
    
    input.dispose();
    actionProbs.dispose();
    
    // Convert TradingAction to TradingSignal
    return {
      direction: action.action === 0 ? -1 : action.action === 2 ? 1 : 0, // Buy=2->1, Sell=0->-1, Hold=1->0
      strength: action.probability,
      confidence: action.probability,
      timestamp: Date.now()
    };
  }
  
  async train(batch: Experience[]): Promise<void> {
    const states = tf.tensor2d(batch.map(e => e.state));
    const actions = tf.tensor1d(batch.map(e => e.action));
    const rewards = tf.tensor1d(batch.map(e => e.reward));
    const nextStates = tf.tensor2d(batch.map(e => e.nextState));
    const dones = tf.tensor1d(batch.map(e => e.done ? 0 : 1));
    
    await tf.tidy(() => {
      const values = this.criticModel.predict(states) as tf.Tensor;
      const nextValues = this.criticModel.predict(nextStates) as tf.Tensor;
      
      // Calculate advantages
      const tdTargets = rewards.add(
        nextValues.squeeze().mul(dones).mul(this.gamma)
      );
      const advantages = tdTargets.sub(values.squeeze());
      
      // Actor loss
      const logProbs = tf.log(
        (this.actorModel.predict(states) as tf.Tensor).add(1e-8)
      );
      const actionIndices = tf.cast(actions, 'int32');
      const selectedLogProbs = tf.gatherND(logProbs, tf.stack([tf.range(0, actions.shape[0]), actionIndices], 1));
      const actorLoss = selectedLogProbs.mul(advantages).mul(-1).mean();
      
      // Critic loss
      const criticLoss = tf.losses.meanSquaredError(tdTargets, values.squeeze());
      
      // Total loss with entropy regularization
      const entropy = logProbs.mul(tf.exp(logProbs)).sum(1).mul(-1).mean();
      const totalLoss = actorLoss.add(criticLoss).sub(entropy.mul(this.entropy_beta));
      
      // Update weights
      const grads = tf.variableGrads(() => totalLoss.mean());
      this.optimizer.applyGradients(grads.grads);
      Object.values(grads.grads).forEach(grad => grad?.dispose());
    });

    states.dispose();
    nextStates.dispose();
    actions.dispose();
    rewards.dispose();
    dones.dispose();
  }

  private featuresToArray(features: MarketFeatures): number[] {
    if (features.microstructure) {
      const ms = features.microstructure;
      const vector: number[] = [
        ms.bidAskSpread,
        ms.orderFlowToxicity,
        ms.priceImpact,
        ...ms.orderImbalance,
        ...Array.from(ms.volumeProfile),
        ...ms.liquidityDepth.slice(0, 17)
      ];
      
      while (vector.length < 50) vector.push(0);
      return vector.slice(0, 50);
    }

    // Return zero vector if no microstructure is available
    return new Array(50).fill(0);
  }

  private async sampleAction(actionProbs: tf.Tensor): Promise<TradingAction> {
    const raw = await actionProbs.array() as number[][];
    const probs = raw[0] ?? [];
    let maxIndex = 0;
    let maxValue = probs[0] ?? 0;
    for (let i = 1; i < probs.length; i += 1) {
      if (probs[i] > maxValue) {
        maxValue = probs[i];
        maxIndex = i;
      }
    }

    return { action: maxIndex, probability: maxValue };
  }
}

export default A3CAgent;