import * as tf from '@tensorflow/tfjs';
import { MarketFeatures, Experience, TradingSignal } from '@tradingEngine/types';

interface TradingAction {
  action: number;
  probability: number;
}

// src/tradingEngine/A3CAgent.ts
let a3cInstanceCount = 0;

class A3CAgent {
  private actorModel!: tf.LayersModel;
  private criticModel!: tf.LayersModel;
  private optimizer!: tf.Optimizer;
  private gamma: number = 0.99;
  private entropy_beta: number = 0.01;
  private scopeName: string;
  
  constructor() {
    this.scopeName = `a3c_${++a3cInstanceCount}_${Date.now()}`;
    this.optimizer = tf.train.adam(0.0001);
    this.buildModels();
  }

  dispose(): void {
    this.actorModel?.dispose();
    this.criticModel?.dispose();
  }
  
  private buildModels() {
    // Actor network
    const actorInput = tf.input({ shape: [50], name: `${this.scopeName}_actor_in` });
    const actorHidden1 = tf.layers.dense({
      units: 256,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      name: `${this.scopeName}_actor_h1`
    }).apply(actorInput);
    
    const actorHidden2 = tf.layers.dense({
      units: 128,
      activation: 'relu',
      name: `${this.scopeName}_actor_h2`
    }).apply(actorHidden1);
    
    const policyOutput = tf.layers.dense({
      units: 3, // Buy, Hold, Sell
      activation: 'softmax',
      name: `${this.scopeName}_actor_out`
    }).apply(actorHidden2);
    
    this.actorModel = tf.model({
      inputs: actorInput,
      outputs: policyOutput as tf.SymbolicTensor,
      name: `${this.scopeName}_actor`
    });
    
    this.actorModel.compile({
      optimizer: this.optimizer,
      loss: 'categoricalCrossentropy'
    });
    
    // Critic network
    const criticInput = tf.input({ shape: [50], name: `${this.scopeName}_critic_in` });
    const criticHidden1 = tf.layers.dense({
      units: 256,
      activation: 'relu',
      name: `${this.scopeName}_critic_h1`
    }).apply(criticInput);
    
    const criticHidden2 = tf.layers.dense({
      units: 128,
      activation: 'relu',
      name: `${this.scopeName}_critic_h2`
    }).apply(criticHidden1);
    
    const valueOutput = tf.layers.dense({
      units: 1,
      name: `${this.scopeName}_critic_out`
    }).apply(criticHidden2);
    
    this.criticModel = tf.model({
      inputs: criticInput,
      outputs: valueOutput as tf.SymbolicTensor,
      name: `${this.scopeName}_critic`
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
    // Manual tensor management — tf.tidy is synchronous and cannot wrap async ops
    const states = tf.tensor2d(batch.map(e => e.state));
    const actions = tf.tensor1d(batch.map(e => e.action));
    const rewards = tf.tensor1d(batch.map(e => e.reward));
    const nextStates = tf.tensor2d(batch.map(e => e.nextState));
    const dones = tf.tensor1d(batch.map(e => e.done ? 0 : 1));
    
    const intermediates: tf.Tensor[] = [];
    try {
      const values = this.criticModel.predict(states) as tf.Tensor;
      const nextValues = this.criticModel.predict(nextStates) as tf.Tensor;
      intermediates.push(values, nextValues);
      
      // Calculate advantages
      const nextValSqueezed = nextValues.squeeze();
      const discounted = nextValSqueezed.mul(dones).mul(this.gamma);
      const tdTargets = rewards.add(discounted);
      const valSqueezed = values.squeeze();
      const advantages = tdTargets.sub(valSqueezed);
      intermediates.push(nextValSqueezed, discounted, tdTargets, valSqueezed, advantages);
      
      // Actor loss
      const actorPred = this.actorModel.predict(states) as tf.Tensor;
      const logProbs = tf.log(actorPred.add(1e-8));
      const actionIndices = tf.cast(actions, 'int32');
      const indexTensor = tf.stack([tf.range(0, actions.shape[0]), actionIndices], 1);
      const selectedLogProbs = tf.gatherND(logProbs, indexTensor);
      const actorLoss = selectedLogProbs.mul(advantages).mul(-1).mean();
      intermediates.push(actorPred, logProbs, actionIndices, indexTensor, selectedLogProbs, actorLoss);
      
      // Critic loss
      const criticLoss = tf.losses.meanSquaredError(tdTargets, valSqueezed) as tf.Tensor;
      intermediates.push(criticLoss);
      
      // Total loss with entropy regularization
      const expLogProbs = tf.exp(logProbs);
      const entropy = logProbs.mul(expLogProbs).sum(1).mul(-1).mean();
      const totalLoss = actorLoss.add(criticLoss).sub(entropy.mul(this.entropy_beta));
      intermediates.push(expLogProbs, entropy, totalLoss);
      
      // Update weights via gradient tape
      const lossForGrad = totalLoss.mean().asScalar();
      intermediates.push(lossForGrad);
      const grads = tf.variableGrads(() => lossForGrad);
      this.optimizer.applyGradients(grads.grads);
      Object.values(grads.grads).forEach(grad => grad?.dispose());
    } finally {
      intermediates.forEach(t => t.dispose());
      states.dispose();
      nextStates.dispose();
      actions.dispose();
      rewards.dispose();
      dones.dispose();
    }
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