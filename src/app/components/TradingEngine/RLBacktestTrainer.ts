// ─── RL Backtest Trainer ─────────────────────────────────────────────────────
// Every 100 ticks, backtests the 6-hour collected data to generate training
// experiences. Uses a DQN to learn optimal entry points from indicator features.
//
// Flow: RLDataCollector (6hr buffer) → backtest simulation → reward computation
//       → experience replay → DQN training → real-time entry signal output

import * as tf from '@tensorflow/tfjs';
import type { RLSnapshot } from './RLDataCollector';
import { RL_FEATURE_DIM } from './RLDataCollector';

// ─── Action Space ───────────────────────────────────────────────────────────

export enum RLAction {
  STRONG_SELL = 0,
  SELL = 1,
  HOLD = 2,
  BUY = 3,
  STRONG_BUY = 4,
}

export const ACTION_SIZE = 5;

const ACTION_DIRECTION: Record<RLAction, number> = {
  [RLAction.STRONG_SELL]: -1,
  [RLAction.SELL]: -0.5,
  [RLAction.HOLD]: 0,
  [RLAction.BUY]: 0.5,
  [RLAction.STRONG_BUY]: 1,
};

// ─── Experience for replay buffer (with PER priority) ───────────────────────

interface RLExperience {
  state: number[];
  action: number;
  reward: number;
  nextState: number[];
  done: boolean;
  tdError: number;   // TD-error for Prioritized Experience Replay
  age: number;       // tick when added (for staleness)
}

// ─── Training state exposed to UI ──────────────────────────────────────────

export interface RLTrainerState {
  // Agent status
  isWarmedUp: boolean;
  totalTrainSteps: number;
  lastLoss: number;
  epsilon: number;
  // Current signal
  currentAction: RLAction;
  currentConfidence: number;
  qValues: number[];
  // Backtest stats from last training run
  lastBacktestTrades: number;
  lastBacktestWinRate: number;
  lastBacktestPnL: number;
  lastBacktestSharpe: number;
  // Replay buffer
  replayBufferSize: number;
  // Training history
  avgReward: number;
  cumulativePnL: number;
  // Validation metrics (OOS)
  validationWinRate: number;
  validationPnL: number;
  validationSharpe: number;
  // Training intensity
  trainFrequency: number;
  rewardMean: number;
  rewardStd: number;
}

// ─── Config ─────────────────────────────────────────────────────────────────

export interface RLTrainerConfig {
  trainEveryTicks: number;    // Train every N ticks (default: 100)
  minBufferSize: number;      // Min snapshots before training starts
  batchSize: number;          // Training batch size
  replayCapacity: number;     // Max experiences in replay buffer
  gamma: number;              // Discount factor
  epsilonStart: number;       // Initial exploration rate
  epsilonEnd: number;         // Final exploration rate
  epsilonDecay: number;       // Decay rate per train step
  learningRate: number;       // DQN learning rate
  lookAheadTicks: number;     // Ticks to look ahead for reward computation
  holdPenalty: number;        // Penalty per tick for holding a position
  transactionCost: number;    // Simulated transaction cost (% of price)
  // PER (Prioritized Experience Replay)
  perAlpha: number;           // Priority exponent (0=uniform, 1=full priority)
  perBetaStart: number;       // IS weight annealing start
  perBetaEnd: number;         // IS weight annealing end
  // Adaptive training
  trainFreqMin: number;       // Min ticks between training (aggressive early)
  trainFreqMax: number;       // Max ticks between training (stable later)
  matureSteps: number;        // Steps to reach mature training frequency
  // Validation
  validationSplit: number;    // Fraction of buffer held out for validation (0.2 = 20%)
  // Reward normalization
  rewardClip: number;         // Clip rewards to [-clip, clip]
}

const DEFAULT_CONFIG: RLTrainerConfig = {
  trainEveryTicks: 100,
  minBufferSize: 200,         // lowered: ~2.5 min at 800ms throttle
  batchSize: 64,
  replayCapacity: 100000,     // doubled for more diverse experience
  gamma: 0.95,
  epsilonStart: 1.0,
  epsilonEnd: 0.05,
  epsilonDecay: 0.9995,
  learningRate: 0.0003,
  lookAheadTicks: 30,         // ~24 seconds ahead
  holdPenalty: 0.0001,
  transactionCost: 0.0004,    // 0.04% (typical taker fee)
  perAlpha: 0.6,
  perBetaStart: 0.4,
  perBetaEnd: 1.0,
  trainFreqMin: 20,           // train every 20 ticks when young
  trainFreqMax: 100,          // taper to every 100 ticks when mature
  matureSteps: 500,           // reach maturity after 500 train steps
  validationSplit: 0.2,       // hold out 20% for OOS validation
  rewardClip: 5.0,            // clip rewards to [-5, 5]
};

// ─── DQN Model Builder ─────────────────────────────────────────────────────

function buildDQN(stateSize: number, actionSize: number, lr: number, prefix: string): tf.LayersModel {
  const pfx = `${prefix}_`;
  const input = tf.input({ shape: [stateSize], name: `${pfx}in` });

  // Shared backbone
  const d1 = tf.layers.dense({ name: `${pfx}d1`, units: 128, activation: 'relu' }).apply(input);
  const bn1 = tf.layers.batchNormalization({ name: `${pfx}bn1` }).apply(d1 as tf.SymbolicTensor);
  const d2 = tf.layers.dense({ name: `${pfx}d2`, units: 64, activation: 'relu' }).apply(bn1 as tf.SymbolicTensor);
  const drop = tf.layers.dropout({ name: `${pfx}drop`, rate: 0.1 }).apply(d2 as tf.SymbolicTensor);

  // Dueling streams
  const valStream = tf.layers.dense({ name: `${pfx}vs`, units: 32, activation: 'relu' }).apply(drop as tf.SymbolicTensor);
  const valOut = tf.layers.dense({ name: `${pfx}v`, units: 1 }).apply(valStream as tf.SymbolicTensor);

  const advStream = tf.layers.dense({ name: `${pfx}as`, units: 32, activation: 'relu' }).apply(drop as tf.SymbolicTensor);
  const advOut = tf.layers.dense({ name: `${pfx}a`, units: actionSize }).apply(advStream as tf.SymbolicTensor);

  // Q = V + (A - mean(A))
  const qValues = tf.layers.add({ name: `${pfx}q` }).apply([
    valOut as tf.SymbolicTensor,
    advOut as tf.SymbolicTensor,
  ]);

  const model = tf.model({ inputs: input, outputs: qValues as tf.SymbolicTensor });
  model.compile({ optimizer: tf.train.adam(lr), loss: 'meanSquaredError' });
  return model;
}

// ─── Trainer ────────────────────────────────────────────────────────────────

class RLBacktestTrainer {
  private config: RLTrainerConfig;

  // DQN: online + target network
  private onlineNet: tf.LayersModel;
  private targetNet: tf.LayersModel;
  private trainSteps: number = 0;
  private targetUpdateFreq: number = 500; // sync target every N train steps

  // Prioritized Replay buffer
  private replay: RLExperience[] = [];
  private perBeta: number;

  // Exploration
  private epsilon: number;

  // Running stats
  private lastLoss: number = 0;
  private lastBacktest = { trades: 0, winRate: 0, pnl: 0, sharpe: 0 };
  private avgReward: number = 0;
  private rewardEma: number = 0;
  private cumulativePnL: number = 0;

  // Reward normalization running stats
  private rewardRunMean: number = 0;
  private rewardRunVar: number = 1;
  private rewardCount: number = 0;

  // Validation metrics
  private lastValidation = { winRate: 0, pnl: 0, sharpe: 0 };

  // Adaptive training frequency
  private currentTrainFreq: number;
  private ticksSinceLastTrain: number = 0;
  private isTraining: boolean = false;

  // Current inference
  private currentAction: RLAction = RLAction.HOLD;
  private currentConfidence: number = 0;
  private currentQValues: number[] = [0, 0, 0, 0, 0];

  private pfx: string;

  constructor(config?: Partial<RLTrainerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.epsilon = this.config.epsilonStart;
    this.perBeta = this.config.perBetaStart;
    this.currentTrainFreq = this.config.trainFreqMin;
    this.pfx = `rl${Math.random().toString(36).slice(2, 6)}`;

    this.onlineNet = buildDQN(RL_FEATURE_DIM, ACTION_SIZE, this.config.learningRate, `${this.pfx}_on`);
    this.targetNet = buildDQN(RL_FEATURE_DIM, ACTION_SIZE, this.config.learningRate, `${this.pfx}_tgt`);
    this.syncTargetNet();
  }

  // ─── Main entry: call every tick with current snapshot ────────────────

  tick(snapshot: RLSnapshot, buffer: readonly RLSnapshot[]): RLTrainerState {
    // Always infer current action
    this.infer(snapshot.features);

    // Adaptive training frequency: train more aggressively early, taper when mature
    this.ticksSinceLastTrain++;
    this.updateTrainFrequency();

    const tickCount = buffer.length;
    const shouldTrain = tickCount >= this.config.minBufferSize
      && this.ticksSinceLastTrain >= this.currentTrainFreq;

    if (shouldTrain) {
      this.ticksSinceLastTrain = 0;
      this.runBacktestAndTrain(buffer);
    }

    return this.getState();
  }

  // ─── Adaptive training schedule ────────────────────────────────────────

  private updateTrainFrequency(): void {
    const { trainFreqMin, trainFreqMax, matureSteps } = this.config;
    const progress = Math.min(1, this.trainSteps / matureSteps);
    // Lerp from aggressive (min) to relaxed (max)
    this.currentTrainFreq = Math.round(
      trainFreqMin + (trainFreqMax - trainFreqMin) * progress,
    );
  }

  // ─── Inference: get action from current state ────────────────────────

  private infer(features: number[]): void {
    // ε-greedy
    if (Math.random() < this.epsilon) {
      this.currentAction = Math.floor(Math.random() * ACTION_SIZE) as RLAction;
      this.currentConfidence = 0;
      this.currentQValues = [0, 0, 0, 0, 0];
      return;
    }

    const input = tf.tensor2d([features]);
    const qTensor = this.onlineNet.predict(input) as tf.Tensor;
    const qValues = Array.from(qTensor.dataSync());
    input.dispose();
    qTensor.dispose();

    this.currentQValues = qValues;

    // Pick best action
    let bestAction = 0;
    let bestQ = qValues[0];
    for (let i = 1; i < qValues.length; i++) {
      if (qValues[i] > bestQ) {
        bestQ = qValues[i];
        bestAction = i;
      }
    }

    this.currentAction = bestAction as RLAction;

    // Confidence: softmax-like over Q-values
    const maxQ = Math.max(...qValues);
    const expSum = qValues.reduce((s, q) => s + Math.exp(q - maxQ), 0);
    this.currentConfidence = expSum > 0 ? Math.exp(bestQ - maxQ) / expSum : 0;
  }

  // ─── Core: backtest collected data and generate training experiences ──

  private async runBacktestAndTrain(buffer: readonly RLSnapshot[]): Promise<void> {
    if (this.isTraining) return; // prevent concurrent fit() calls
    this.isTraining = true;

    const { lookAheadTicks, transactionCost, holdPenalty } = this.config;
    const n = buffer.length;
    const maxStart = n - lookAheadTicks - 1;
    if (maxStart < 1) { this.isTraining = false; return; }

    // ── Phase 1: Backtest — simulate entries at sampled points ──────
    const sampleCount = Math.min(500, maxStart);
    const experiences: RLExperience[] = [];
    let btTrades = 0, btWins = 0, btPnL = 0;
    const returns: number[] = [];

    for (let s = 0; s < sampleCount; s++) {
      const idx = Math.floor(Math.random() * maxStart);
      const snap = buffer[idx];
      const futureSnap = buffer[Math.min(idx + lookAheadTicks, n - 1)];

      // Get agent's action for this historical state
      const input = tf.tensor2d([snap.features]);
      const qTensor = this.onlineNet.predict(input) as tf.Tensor;
      const qValues = Array.from(qTensor.dataSync());
      input.dispose();
      qTensor.dispose();

      // ε-greedy action selection for exploration
      let action: number;
      if (Math.random() < this.epsilon) {
        action = Math.floor(Math.random() * ACTION_SIZE);
      } else {
        action = qValues.indexOf(Math.max(...qValues));
      }

      const direction = ACTION_DIRECTION[action as RLAction];

      // ── Compute reward ────────────────────────────────────────────
      let reward = 0;
      if (direction !== 0) {
        // Entry trade
        const entryPrice = snap.raw.price;
        const exitPrice = futureSnap.raw.price;
        const pnlPct = direction * (exitPrice - entryPrice) / entryPrice;
        const netPnl = pnlPct - transactionCost * 2; // entry + exit fee

        reward = netPnl * 100; // scale to make learning easier

        btTrades++;
        if (netPnl > 0) btWins++;
        btPnL += netPnl;
        returns.push(netPnl);
      } else {
        // HOLD: small penalty for inaction when there was opportunity
        const movePct = Math.abs(futureSnap.raw.price - snap.raw.price) / snap.raw.price;
        reward = -holdPenalty - movePct * 10; // penalize more if market moved a lot
      }

      // Bonus: alignment with trend (EMA crossover direction matches action)
      const emaCross = snap.features[3]; // ema9_21_cross
      if (direction > 0 && emaCross > 0) reward += 0.05;
      if (direction < 0 && emaCross < 0) reward += 0.05;

      // Normalize reward using running stats
      reward = this.normalizeReward(reward);

      // Build experience
      const nextIdx = Math.min(idx + 1, n - 1);
      experiences.push({
        state: snap.features,
        action,
        reward,
        nextState: buffer[nextIdx].features,
        done: idx + lookAheadTicks >= n - 1,
        tdError: Math.abs(reward) + 1e-6, // initial priority = |reward| (updated after training)
        age: this.trainSteps,
      });
    }

    // Backtest stats
    const avgReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
    const stdReturn = returns.length > 1
      ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1))
      : 1;
    const sharpe = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

    this.lastBacktest = {
      trades: btTrades,
      winRate: btTrades > 0 ? btWins / btTrades : 0,
      pnl: btPnL,
      sharpe,
    };

    // ── Phase 2: Add experiences to replay buffer ───────────────────
    for (const exp of experiences) {
      this.replay.push(exp);
      if (this.replay.length > this.config.replayCapacity) {
        this.replay.shift();
      }
    }

    // ── Phase 3: Train DQN from replay buffer (PER) ─────────────────
    if (this.replay.length >= this.config.batchSize) {
      await this.trainStep();
    }

    // ── Phase 4: Validation on held-out data ─────────────────────────
    if (this.trainSteps > 0 && this.trainSteps % 5 === 0) {
      this.runValidation(buffer);
    }

    this.isTraining = false;
  }

  // ─── Reward Normalization ──────────────────────────────────────────────

  private normalizeReward(reward: number): number {
    // Welford's online algorithm for running mean/var
    this.rewardCount++;
    const delta = reward - this.rewardRunMean;
    this.rewardRunMean += delta / this.rewardCount;
    const delta2 = reward - this.rewardRunMean;
    this.rewardRunVar += (delta * delta2 - this.rewardRunVar) / Math.max(this.rewardCount, 2);

    const std = Math.sqrt(Math.max(this.rewardRunVar, 1e-8));
    const normalized = (reward - this.rewardRunMean) / std;

    // Clip to prevent extreme values
    return Math.max(-this.config.rewardClip, Math.min(this.config.rewardClip, normalized));
  }

  // ─── PER: Prioritized sampling ─────────────────────────────────────────

  private samplePER(batchSize: number): { batch: RLExperience[]; indices: number[]; isWeights: number[] } {
    const { perAlpha } = this.config;
    const n = this.replay.length;

    // Compute priorities
    const priorities = this.replay.map(e => Math.pow(Math.abs(e.tdError) + 1e-6, perAlpha));
    const totalPriority = priorities.reduce((s, p) => s + p, 0);

    const batch: RLExperience[] = [];
    const indices: number[] = [];
    const isWeights: number[] = [];

    for (let i = 0; i < batchSize; i++) {
      // Weighted random sampling
      let r = Math.random() * totalPriority;
      let idx = 0;
      let cumSum = priorities[0];
      while (cumSum < r && idx < n - 1) {
        idx++;
        cumSum += priorities[idx];
      }

      batch.push(this.replay[idx]);
      indices.push(idx);

      // Importance Sampling weight: (1/N * 1/P(i))^beta
      const prob = priorities[idx] / totalPriority;
      isWeights.push(Math.pow(n * prob, -this.perBeta));
    }

    // Normalize IS weights
    const maxWeight = Math.max(...isWeights);
    for (let i = 0; i < isWeights.length; i++) {
      isWeights[i] /= maxWeight;
    }

    return { batch, indices, isWeights };
  }

  // ─── DQN Training Step (with PER) ─────────────────────────────────────

  private async trainStep(): Promise<void> {
    const { batchSize, gamma } = this.config;

    // Prioritized sampling
    const { batch, indices, isWeights } = this.samplePER(batchSize);

    // Build tensors
    const states = batch.map(e => e.state);
    const nextStates = batch.map(e => e.nextState);

    const statesTensor = tf.tensor2d(states);
    const nextStatesTensor = tf.tensor2d(nextStates);

    // Double DQN: use online net to select action, target net to evaluate
    const nextQOnline = this.onlineNet.predict(nextStatesTensor) as tf.Tensor;
    const nextQTarget = this.targetNet.predict(nextStatesTensor) as tf.Tensor;
    const nextQOnlineData = nextQOnline.arraySync() as number[][];
    const nextQTargetData = nextQTarget.arraySync() as number[][];
    nextQOnline.dispose();
    nextQTarget.dispose();
    nextStatesTensor.dispose();

    // Current Q-values
    const currentQ = this.onlineNet.predict(statesTensor) as tf.Tensor;
    const currentQData = currentQ.arraySync() as number[][];
    currentQ.dispose();

    // Build targets + update PER priorities
    const targets: number[][] = [];
    let totalReward = 0;
    for (let i = 0; i < batchSize; i++) {
      const exp = batch[i];
      const target = [...currentQData[i]];

      // Double DQN target
      const bestNextAction = nextQOnlineData[i].indexOf(Math.max(...nextQOnlineData[i]));
      const nextValue = exp.done ? 0 : gamma * nextQTargetData[i][bestNextAction];
      const tdTarget = exp.reward + nextValue;

      // TD-error for PER priority update
      const tdError = Math.abs(tdTarget - currentQData[i][exp.action]);
      this.replay[indices[i]].tdError = tdError;

      // Apply IS weight to target (bias correction)
      target[exp.action] = currentQData[i][exp.action] +
        isWeights[i] * (tdTarget - currentQData[i][exp.action]);

      targets.push(target);
      totalReward += exp.reward;
    }

    // Train — MUST await before disposing tensors
    const targetsTensor = tf.tensor2d(targets);
    try {
      const h = await this.onlineNet.fit(statesTensor, targetsTensor, {
        epochs: 1,
        verbose: 0,
      });
      const loss = h.history.loss;
      if (Array.isArray(loss) && typeof loss[0] === 'number') {
        this.lastLoss = loss[0];
      }
    } catch (err) {
      console.warn('[RLTrainer] Training step failed:', err);
    } finally {
      statesTensor.dispose();
      targetsTensor.dispose();
    }

    // Update stats
    this.trainSteps++;
    this.rewardEma = 0.99 * this.rewardEma + 0.01 * (totalReward / batchSize);
    this.avgReward = this.rewardEma;
    this.cumulativePnL += this.lastBacktest.pnl;

    // Decay epsilon
    this.epsilon = Math.max(
      this.config.epsilonEnd,
      this.epsilon * this.config.epsilonDecay,
    );

    // Anneal PER beta toward 1.0
    const betaProgress = Math.min(1, this.trainSteps / this.config.matureSteps);
    this.perBeta = this.config.perBetaStart +
      (this.config.perBetaEnd - this.config.perBetaStart) * betaProgress;

    // Sync target net periodically
    if (this.trainSteps % this.targetUpdateFreq === 0) {
      this.syncTargetNet();
    }
  }

  // ─── Validation: evaluate on held-out data ─────────────────────────────

  private runValidation(buffer: readonly RLSnapshot[]): void {
    const { lookAheadTicks, transactionCost, validationSplit } = this.config;
    const n = buffer.length;
    const valStart = Math.floor(n * (1 - validationSplit));
    const valEnd = n - lookAheadTicks - 1;
    if (valEnd <= valStart) return;

    let wins = 0, trades = 0, totalPnl = 0;
    const returns: number[] = [];
    const sampleCount = Math.min(200, valEnd - valStart);

    for (let s = 0; s < sampleCount; s++) {
      const idx = valStart + Math.floor(Math.random() * (valEnd - valStart));
      const snap = buffer[idx];
      const futureSnap = buffer[Math.min(idx + lookAheadTicks, n - 1)];

      // Greedy inference (no exploration) for validation
      const input = tf.tensor2d([snap.features]);
      const qTensor = this.onlineNet.predict(input) as tf.Tensor;
      const qValues = Array.from(qTensor.dataSync());
      input.dispose();
      qTensor.dispose();

      const action = qValues.indexOf(Math.max(...qValues));
      const direction = ACTION_DIRECTION[action as RLAction];

      if (direction !== 0) {
        const pnlPct = direction * (futureSnap.raw.price - snap.raw.price) / snap.raw.price;
        const netPnl = pnlPct - transactionCost * 2;
        trades++;
        if (netPnl > 0) wins++;
        totalPnl += netPnl;
        returns.push(netPnl);
      }
    }

    const avgReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
    const stdReturn = returns.length > 1
      ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1))
      : 1;

    this.lastValidation = {
      winRate: trades > 0 ? wins / trades : 0,
      pnl: totalPnl,
      sharpe: stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0,
    };
  }

  // ─── Sync target network weights from online network ─────────────────

  private syncTargetNet(): void {
    const onlineWeights = this.onlineNet.getWeights();
    this.targetNet.setWeights(onlineWeights.map(w => w.clone()));
    // Dispose clones from getWeights (they're refs, not clones, so don't dispose)
  }

  // ─── Public API ──────────────────────────────────────────────────────

  getState(): RLTrainerState {
    return {
      isWarmedUp: this.trainSteps > 0,
      totalTrainSteps: this.trainSteps,
      lastLoss: this.lastLoss,
      epsilon: this.epsilon,
      currentAction: this.currentAction,
      currentConfidence: this.currentConfidence,
      qValues: [...this.currentQValues],
      lastBacktestTrades: this.lastBacktest.trades,
      lastBacktestWinRate: this.lastBacktest.winRate,
      lastBacktestPnL: this.lastBacktest.pnl,
      lastBacktestSharpe: this.lastBacktest.sharpe,
      replayBufferSize: this.replay.length,
      avgReward: this.avgReward,
      cumulativePnL: this.cumulativePnL,
      validationWinRate: this.lastValidation.winRate,
      validationPnL: this.lastValidation.pnl,
      validationSharpe: this.lastValidation.sharpe,
      trainFrequency: this.currentTrainFreq,
      rewardMean: this.rewardRunMean,
      rewardStd: Math.sqrt(Math.max(this.rewardRunVar, 0)),
    };
  }

  getCurrentAction(): RLAction {
    return this.currentAction;
  }

  getCurrentSignal(): { direction: number; confidence: number } {
    return {
      direction: ACTION_DIRECTION[this.currentAction],
      confidence: this.currentConfidence,
    };
  }

  // ─── Model Save / Load (IndexedDB) ─────────────────────────────────

  async saveModel(version?: string): Promise<string> {
    const tag = version || `v${Date.now()}`;
    const key = `indexeddb://rl-dqn-${tag}`;
    await this.onlineNet.save(key);
    // Persist metadata alongside
    if (typeof window !== 'undefined') {
      const meta = {
        tag,
        trainSteps: this.trainSteps,
        epsilon: this.epsilon,
        avgReward: this.avgReward,
        cumulativePnL: this.cumulativePnL,
        lastBacktest: this.lastBacktest,
        savedAt: Date.now(),
      };
      localStorage.setItem(`rl-dqn-meta-${tag}`, JSON.stringify(meta));
      // Track version list
      const versions: string[] = JSON.parse(localStorage.getItem('rl-dqn-versions') || '[]');
      if (!versions.includes(tag)) {
        versions.push(tag);
        if (versions.length > 20) versions.shift(); // keep last 20
        localStorage.setItem('rl-dqn-versions', JSON.stringify(versions));
      }
    }
    console.log(`[RLTrainer] Model saved: ${tag}`);
    return tag;
  }

  async loadModel(version: string): Promise<boolean> {
    try {
      const key = `indexeddb://rl-dqn-${version}`;
      const loaded = await tf.loadLayersModel(key);
      loaded.compile({ optimizer: tf.train.adam(this.config.learningRate), loss: 'meanSquaredError' });
      this.onlineNet.dispose();
      this.onlineNet = loaded;
      this.syncTargetNet();

      // Restore metadata
      if (typeof window !== 'undefined') {
        const raw = localStorage.getItem(`rl-dqn-meta-${version}`);
        if (raw) {
          const meta = JSON.parse(raw);
          this.trainSteps = meta.trainSteps ?? 0;
          this.epsilon = meta.epsilon ?? this.config.epsilonEnd;
          this.avgReward = meta.avgReward ?? 0;
          this.rewardEma = meta.avgReward ?? 0;
          this.cumulativePnL = meta.cumulativePnL ?? 0;
          this.lastBacktest = meta.lastBacktest ?? this.lastBacktest;
        }
      }
      console.log(`[RLTrainer] Model loaded: ${version}`);
      return true;
    } catch (err) {
      console.warn(`[RLTrainer] Failed to load model ${version}:`, err);
      return false;
    }
  }

  static getModelVersions(): { tag: string; meta: any }[] {
    if (typeof window === 'undefined') return [];
    const versions: string[] = JSON.parse(localStorage.getItem('rl-dqn-versions') || '[]');
    return versions.map(tag => {
      const raw = localStorage.getItem(`rl-dqn-meta-${tag}`);
      return { tag, meta: raw ? JSON.parse(raw) : null };
    });
  }

  // ─── External training trigger (for historical bootstrap) ──────────

  runExternalTraining(buffer: readonly RLSnapshot[]): void {
    if (buffer.length >= this.config.minBufferSize) {
      this.runBacktestAndTrain(buffer);
    }
  }

  // ─── Warm-start: reduce epsilon after pre-training ─────────────────

  warmStart(targetEpsilon?: number): void {
    const eps = targetEpsilon ?? 0.3;
    if (this.trainSteps > 0) {
      this.epsilon = Math.max(this.config.epsilonEnd, eps);
      console.log(`[RLTrainer] Warm-started: ε=${this.epsilon.toFixed(3)}, steps=${this.trainSteps}`);
    }
  }

  dispose(): void {
    this.onlineNet.dispose();
    this.targetNet.dispose();
    this.replay = [];
  }
}

export default RLBacktestTrainer;
