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
    
    // Build independent target networks (separate layers, own weight storage)
    this.targetActor = this.buildTargetActor();
    this.targetCritic = this.buildTargetCritic();
    // Initialize target weights = online weights
    this.targetActor.setWeights(this.actor.getWeights());
    this.targetCritic.setWeights(this.critic.getWeights());
  }

  private buildTargetActor(): tf.LayersModel {
    const sfx = `${this.scopeName}_tgt_actor`;
    const inp = tf.input({ shape: [50], name: `${sfx}_in` });
    const h1 = tf.layers.dense({ units: 400, activation: 'relu', kernelInitializer: 'glorotUniform', name: `${sfx}_h1` }).apply(inp);
    const h2 = tf.layers.dense({ units: 300, activation: 'relu', name: `${sfx}_h2` }).apply(h1 as tf.SymbolicTensor);
    const out = tf.layers.dense({ units: 1, activation: 'tanh', name: `${sfx}_out` }).apply(h2 as tf.SymbolicTensor);
    const model = tf.model({ inputs: inp, outputs: out as tf.SymbolicTensor, name: sfx });
    model.compile({ optimizer: tf.train.adam(0.0001), loss: 'meanSquaredError' });
    return model;
  }

  private buildTargetCritic(): tf.LayersModel {
    const sfx = `${this.scopeName}_tgt_critic`;
    const sIn = tf.input({ shape: [50], name: `${sfx}_sin` });
    const aIn = tf.input({ shape: [1], name: `${sfx}_ain` });
    const sH = tf.layers.dense({ units: 400, activation: 'relu', name: `${sfx}_h1` }).apply(sIn);
    const cat = tf.layers.concatenate({ name: `${sfx}_cat` }).apply([sH as tf.SymbolicTensor, aIn]);
    const h2 = tf.layers.dense({ units: 300, activation: 'relu', name: `${sfx}_h2` }).apply(cat as tf.SymbolicTensor);
    const out = tf.layers.dense({ units: 1, name: `${sfx}_out` }).apply(h2 as tf.SymbolicTensor);
    const model = tf.model({ inputs: [sIn, aIn], outputs: out as tf.SymbolicTensor, name: sfx });
    model.compile({ optimizer: tf.train.adam(0.001), loss: 'meanSquaredError' });
    return model;
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

  storeExperience(experience: Experience): void {
    this.replayBuffer.add(experience);
  }

  async train(batchSize: number = 64): Promise<void> {
    const batch = this.replayBuffer.sample(batchSize);
    if (batch.length < batchSize) return;

    const states = tf.tensor2d(batch.map(e => e.state));
    const actions = tf.tensor2d(batch.map(e => [e.action])); // continuous action
    const rewards = tf.tensor1d(batch.map(e => e.reward));
    const nextStates = tf.tensor2d(batch.map(e => e.nextState));
    const dones = tf.tensor1d(batch.map(e => e.done ? 0 : 1));

    const intermediates: tf.Tensor[] = [];
    try {
      // ─── Critic update: minimize TD error ───────────────────────────
      const nextActions = this.targetActor.predict(nextStates) as tf.Tensor;
      const nextQ = (this.targetCritic.predict([nextStates, nextActions]) as tf.Tensor).squeeze();
      const targetQ = rewards.add(nextQ.mul(dones).mul(0.99));
      intermediates.push(nextActions, nextQ, targetQ);

      // Fit critic on (state, action) → targetQ
      const targetQ2d = targetQ.reshape([-1, 1]);
      intermediates.push(targetQ2d);
      await this.critic.fit([states, actions], targetQ2d, {
        epochs: 1, batchSize, verbose: 0,
      });

      // ─── Actor update: maximize Q(s, actor(s)) via gradient ─────────
      const actorPred = this.actor.predict(states) as tf.Tensor;
      const qForActor = (this.critic.predict([states, actorPred]) as tf.Tensor).squeeze();
      const actorLoss = qForActor.mul(-1).mean().asScalar();
      intermediates.push(actorPred, qForActor, actorLoss);

      const grads = tf.variableGrads(() => actorLoss);
      (this.actor.optimizer as tf.Optimizer).applyGradients(grads.grads);
      Object.values(grads.grads).forEach(g => g?.dispose());

      // ─── Soft update target networks ────────────────────────────────
      this.softUpdateTargets();
    } finally {
      intermediates.forEach(t => t.dispose());
      states.dispose();
      actions.dispose();
      rewards.dispose();
      nextStates.dispose();
      dones.dispose();
    }
  }

  private softUpdateTargets(): void {
    // θ_target = τ * θ_online + (1 - τ) * θ_target
    const updatePairs: [tf.LayersModel, tf.LayersModel][] = [
      [this.actor, this.targetActor],
      [this.critic, this.targetCritic],
    ];
    for (const [online, target] of updatePairs) {
      const onlineWeights = online.getWeights();
      const targetWeights = target.getWeights();
      const updated = onlineWeights.map((w, i) => {
        const tW = targetWeights[i];
        const blended = w.mul(this.tau).add(tW.mul(1 - this.tau));
        return blended;
      });
      target.setWeights(updated);
      // Dispose blended tensors after setWeights copies them
      updated.forEach(t => t.dispose());
    }
  }

  async predict(features: MarketFeatures, addNoise: boolean = false): Promise<TradingSignal> {
    const state = tf.tensor2d([this.featuresToArray(features)]);
    const rawAction = this.actor.predict(state) as tf.Tensor;
    let action = rawAction;
    const toDispose: tf.Tensor[] = [state, rawAction];
    
    if (addNoise) {
      // Add Ornstein-Uhlenbeck noise for exploration
      const noise = this.ouNoise.sample();
      const noisyAction = rawAction.add(tf.scalar(noise));
      action = tf.clipByValue(noisyAction, -1, 1);
      toDispose.push(noisyAction, action);
    }
    
    const actionValue = await action.data();
    toDispose.forEach(t => t.dispose());
    
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