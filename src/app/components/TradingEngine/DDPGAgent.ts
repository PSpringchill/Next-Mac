import * as tf from '@tensorflow/tfjs';
import { MarketFeatures, Experience, TradingSignal } from '@tradingEngine/types';
import { ReplayBuffer } from '@tradingEngine/utils/buffers';

// src/tradingEngine/DDPGAgent.ts
let ddpgInstanceCount = 0;

class DDPGAgent {
  private actor!: tf.LayersModel;
  private critic!: tf.LayersModel;
  private targetActor!: tf.LayersModel;
  private targetCritic!: tf.LayersModel;
  private replayBuffer!: ReplayBuffer;
  private tau: number = 0.001; // Soft update parameter
  private scopeName: string;
  
  constructor() {
    this.scopeName = `ddpg_${++ddpgInstanceCount}_${Date.now()}`;
    this.buildNetworks();
    this.replayBuffer = new ReplayBuffer(100000);
  }

  dispose(): void {
    this.actor?.dispose();
    this.critic?.dispose();
    this.targetActor?.dispose();
    this.targetCritic?.dispose();
  }
  
  private buildNetworks() {
    // Actor network (outputs continuous action)
    const stateInput = tf.input({ shape: [50], name: `${this.scopeName}_actor_in` });
    const actorH1 = tf.layers.dense({
      units: 400,
      activation: 'relu',
      kernelInitializer: 'glorotUniform',
      name: `${this.scopeName}_actor_h1`
    }).apply(stateInput);
    
    const actorH2 = tf.layers.dense({
      units: 300,
      activation: 'relu',
      name: `${this.scopeName}_actor_h2`
    }).apply(actorH1 as tf.SymbolicTensor);
    
    const actionOutput = tf.layers.dense({
      units: 1, // Position size (-1 to 1)
      activation: 'tanh',
      name: `${this.scopeName}_actor_out`
    }).apply(actorH2 as tf.SymbolicTensor);
    
    this.actor = tf.model({
      inputs: stateInput,
      outputs: actionOutput as tf.SymbolicTensor,
      name: `${this.scopeName}_actor`
    });
    
    this.actor.compile({
      optimizer: tf.train.adam(0.0001),
      loss: 'meanSquaredError'
    });
    
    // Critic network (Q-function)
    const criticStateInput = tf.input({ shape: [50], name: `${this.scopeName}_critic_sin` });
    const criticActionInput = tf.input({ shape: [1], name: `${this.scopeName}_critic_ain` });
    
    const criticState = tf.layers.dense({
      units: 400,
      activation: 'relu',
      name: `${this.scopeName}_critic_h1`
    }).apply(criticStateInput);
    
    const criticConcat = tf.layers.concatenate({
      name: `${this.scopeName}_critic_cat`
    }).apply([
      criticState as tf.SymbolicTensor, 
      criticActionInput
    ]);
    
    const criticH2 = tf.layers.dense({
      units: 300,
      activation: 'relu',
      name: `${this.scopeName}_critic_h2`
    }).apply(criticConcat as tf.SymbolicTensor);
    
    const qValue = tf.layers.dense({
      units: 1,
      name: `${this.scopeName}_critic_out`
    }).apply(criticH2 as tf.SymbolicTensor);
    
    this.critic = tf.model({
      inputs: [criticStateInput, criticActionInput],
      outputs: qValue as tf.SymbolicTensor,
      name: `${this.scopeName}_critic`
    });
    
    this.critic.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'meanSquaredError'
    });
    
    // Clone for target networks
    this.targetActor = this.cloneModel(this.actor, 'target_actor');
    this.targetCritic = this.cloneModel(this.critic, 'target_critic');
  }

  private cloneModel(model: tf.LayersModel, suffix: string = 'clone'): tf.LayersModel {
    const cloned = tf.model({
      inputs: model.inputs,
      outputs: model.outputs,
      name: `${this.scopeName}_${suffix}`
    });
    
    cloned.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'meanSquaredError'
    });
    
    return cloned;
  }

  private ouNoise = {
    theta: 0.15,
    sigma: 0.2,
    dt: 0.01,
    x_prev: 0,
    
    sample(): number {
      const dx = this.theta * (0 - this.x_prev) * this.dt + 
                this.sigma * Math.sqrt(this.dt) * this.gaussianRandom();
      this.x_prev += dx;
      return this.x_prev;
    },
    
    reset(): void {
      this.x_prev = 0;
    },
    
    gaussianRandom(): number {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }
  };

  async predict(features: MarketFeatures, addNoise: boolean = false): Promise<TradingSignal> {
    const state = tf.tensor2d([this.featuresToArray(features)]);
    let action = this.actor.predict(state) as tf.Tensor;
    
    if (addNoise) {
      // Add Ornstein-Uhlenbeck noise for exploration
      const noise = this.ouNoise.sample();
      action = action.add(tf.scalar(noise));
      action = tf.clipByValue(action, -1, 1);
    }
    
    const actionValue = await action.data();
    state.dispose();
    action.dispose();
    
    // Convert to TradingSignal
    const direction = actionValue[0] > 0 ? 1 : -1;
    const strength = Math.abs(actionValue[0]);
    
    return {
      direction,
      strength,
      confidence: strength,
      timestamp: Date.now()
    };
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
}

export default DDPGAgent;