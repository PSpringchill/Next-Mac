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

// ─── Experience for replay buffer ───────────────────────────────────────────

interface RLExperience {
  state: number[];
  action: number;
  reward: number;
  nextState: number[];
  done: boolean;
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
}

const DEFAULT_CONFIG: RLTrainerConfig = {
  trainEveryTicks: 100,
  minBufferSize: 500,         // ~7 minutes at 800ms throttle
  batchSize: 64,
  replayCapacity: 50000,
  gamma: 0.95,
  epsilonStart: 1.0,
  epsilonEnd: 0.05,
  epsilonDecay: 0.9995,
  learningRate: 0.0003,
  lookAheadTicks: 30,         // ~24 seconds ahead
  holdPenalty: 0.0001,
  transactionCost: 0.0004,    // 0.04% (typical taker fee)
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

  // Replay buffer
  private replay: RLExperience[] = [];

  // Exploration
  private epsilon: number;

  // Running stats
  private lastLoss: number = 0;
  private lastBacktest = { trades: 0, winRate: 0, pnl: 0, sharpe: 0 };
  private avgReward: number = 0;
  private rewardEma: number = 0;
  private cumulativePnL: number = 0;

  // Current inference
  private currentAction: RLAction = RLAction.HOLD;
  private currentConfidence: number = 0;
  private currentQValues: number[] = [0, 0, 0, 0, 0];

  private pfx: string;

  constructor(config?: Partial<RLTrainerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.epsilon = this.config.epsilonStart;
    this.pfx = `rl${Math.random().toString(36).slice(2, 6)}`;

    this.onlineNet = buildDQN(RL_FEATURE_DIM, ACTION_SIZE, this.config.learningRate, `${this.pfx}_on`);
    this.targetNet = buildDQN(RL_FEATURE_DIM, ACTION_SIZE, this.config.learningRate, `${this.pfx}_tgt`);
    this.syncTargetNet();
  }

  // ─── Main entry: call every tick with current snapshot ────────────────

  tick(snapshot: RLSnapshot, buffer: readonly RLSnapshot[]): RLTrainerState {
    // Always infer current action
    this.infer(snapshot.features);

    // Check if we should train
    const tickCount = buffer.length;
    const shouldTrain = tickCount >= this.config.minBufferSize
      && tickCount % this.config.trainEveryTicks === 0;

    if (shouldTrain) {
      this.runBacktestAndTrain(buffer);
    }

    return this.getState();
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

  private runBacktestAndTrain(buffer: readonly RLSnapshot[]): void {
    const { lookAheadTicks, transactionCost, holdPenalty } = this.config;
    const n = buffer.length;
    const maxStart = n - lookAheadTicks - 1;
    if (maxStart < 1) return;

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

      // Build experience
      const nextIdx = Math.min(idx + 1, n - 1);
      experiences.push({
        state: snap.features,
        action,
        reward,
        nextState: buffer[nextIdx].features,
        done: idx + lookAheadTicks >= n - 1,
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

    // ── Phase 3: Train DQN from replay buffer ───────────────────────
    if (this.replay.length >= this.config.batchSize) {
      this.trainStep();
    }
  }

  // ─── DQN Training Step ───────────────────────────────────────────────

  private trainStep(): void {
    const { batchSize, gamma } = this.config;

    // Sample random batch from replay
    const batch: RLExperience[] = [];
    for (let i = 0; i < batchSize; i++) {
      batch.push(this.replay[Math.floor(Math.random() * this.replay.length)]);
    }

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

    // Build targets
    const targets: number[][] = [];
    let totalReward = 0;
    for (let i = 0; i < batchSize; i++) {
      const exp = batch[i];
      const target = [...currentQData[i]];

      // Double DQN target
      const bestNextAction = nextQOnlineData[i].indexOf(Math.max(...nextQOnlineData[i]));
      const nextValue = exp.done ? 0 : gamma * nextQTargetData[i][bestNextAction];
      target[exp.action] = exp.reward + nextValue;

      targets.push(target);
      totalReward += exp.reward;
    }

    // Train
    const targetsTensor = tf.tensor2d(targets);
    const history = this.onlineNet.fit(statesTensor, targetsTensor, {
      epochs: 1,
      verbose: 0,
    });

    history.then(h => {
      const loss = h.history.loss;
      if (Array.isArray(loss) && typeof loss[0] === 'number') {
        this.lastLoss = loss[0];
      }
    }).catch(() => {});

    statesTensor.dispose();
    targetsTensor.dispose();

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

    // Sync target net periodically
    if (this.trainSteps % this.targetUpdateFreq === 0) {
      this.syncTargetNet();
    }
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

  dispose(): void {
    this.onlineNet.dispose();
    this.targetNet.dispose();
    this.replay = [];
  }
}

export default RLBacktestTrainer;
