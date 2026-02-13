// ─── A3C Balance Protection Agent ────────────────────────────────────────────
// Learns to protect balance, lock profits, ensure safety & security.
// Actions: hold, reduce, close, hedge (partial/full), grid entry,
//          martingale double-down, trailing stop tighten.
//
// Reward: heavily penalizes drawdown, rewards profit preservation,
//         Sharpe-like risk-adjusted returns, hedge variance reduction.

import * as tf from '@tensorflow/tfjs';
import type { PortfolioState } from '@tradingEngine/types';
import type { TechnicalState } from './TechnicalIndicators';
import type { CircuitBreakerState } from './RiskManager';
import type { RLTrainerState } from './RLBacktestTrainer';

// ─── Action Space ───────────────────────────────────────────────────────────

export enum ProtectAction {
  HOLD = 0,              // Do nothing — maintain current position
  REDUCE_25 = 1,         // Reduce position by 25%
  REDUCE_50 = 2,         // Reduce position by 50%
  CLOSE_ALL = 3,         // Close all positions immediately
  HEDGE_PARTIAL = 4,     // Open partial opposite position (50% hedge)
  HEDGE_FULL = 5,        // Open full opposite position (100% hedge)
  GRID_ENTRY = 6,        // Place grid order at next level (DCA)
  MARTINGALE_DOUBLE = 7, // Double down on losing position (2x)
  TRAIL_STOP = 8,        // Tighten stop loss to lock profits
}

export const PROTECT_ACTION_SIZE = 9;

export const PROTECT_ACTION_LABELS: Record<ProtectAction, string> = {
  [ProtectAction.HOLD]: 'HOLD',
  [ProtectAction.REDUCE_25]: 'REDUCE 25%',
  [ProtectAction.REDUCE_50]: 'REDUCE 50%',
  [ProtectAction.CLOSE_ALL]: 'CLOSE ALL',
  [ProtectAction.HEDGE_PARTIAL]: 'HEDGE 50%',
  [ProtectAction.HEDGE_FULL]: 'HEDGE 100%',
  [ProtectAction.GRID_ENTRY]: 'GRID ENTRY',
  [ProtectAction.MARTINGALE_DOUBLE]: 'MARTINGALE 2×',
  [ProtectAction.TRAIL_STOP]: 'TRAIL STOP',
};

// ─── State Vector ───────────────────────────────────────────────────────────

export const PROTECT_STATE_DIM = 32;

export const PROTECT_STATE_NAMES = [
  // Portfolio (0-7)
  'position_size',        // 0  Normalized position size [-1, 1]
  'position_direction',   // 1  -1 short, 0 flat, +1 long
  'unrealized_pnl_norm',  // 2  Unrealized PnL / initial balance
  'daily_pnl_norm',       // 3  Daily PnL / initial balance
  'max_drawdown_norm',    // 4  Max drawdown today / initial balance
  'margin_utilization',   // 5  [0, 1]
  'time_in_trade_norm',   // 6  Time in trade / max expected (3600s)
  'risk_budget',          // 7  Available risk budget [0, 1]
  // Risk metrics (8-12)
  'circuit_breaker_level', // 8  CB level / 3
  'consecutive_losses',    // 9  Normalized consecutive losses
  'pnl_from_peak',        // 10 (peak PnL - current) / ATR — drawdown severity
  'profit_locked_pct',    // 11 Locked profit % of peak
  'win_rate_today',       // 12 Win rate today [0, 1]
  // Market conditions (13-20)
  'atr_percentile',       // 13 ATR percentile [0, 1]
  'adx_norm',             // 14 ADX / 100
  'adx_di_diff',          // 15 (PDI - MDI) / 100
  'rsi_norm',             // 16 RSI / 100
  'bb_percent_b',         // 17 BB %B
  'bb_squeeze',           // 18 1 if squeeze, 0 otherwise
  'macd_aligned',         // 19 -1/0/+1
  'stoch_k_norm',         // 20 Stoch K / 100
  // Trend & momentum (21-25)
  'price_chg_5',          // 21 5-tick price change %
  'price_chg_20',         // 22 20-tick price change %
  'price_chg_50',         // 23 50-tick price change %
  'spread_norm',          // 24 Spread / ATR
  'volume_roc',           // 25 Volume rate of change
  // RL signal (26-27)
  'rl_direction',         // 26 RL trainer direction [-1, 1]
  'rl_confidence',        // 27 RL trainer confidence [0, 1]
  // Hedge/Grid state (28-31)
  'hedge_ratio',          // 28 Current hedge ratio [0, 1]
  'grid_level',           // 29 Current grid level / max grid
  'martingale_count',     // 30 Martingale count / max
  'trail_stop_distance',  // 31 Trail stop distance / ATR
] as const;

// ─── Grid & Martingale State ────────────────────────────────────────────────

export interface GridMartingaleState {
  gridOrders: Array<{ price: number; size: number; direction: 1 | -1 }>;
  gridSpacing: number;         // ATR-based grid spacing
  gridMaxLevels: number;       // Max grid levels (default 5)
  martingaleCount: number;     // How many times we've doubled
  martingaleMaxCount: number;  // Max doublings allowed (default 3)
  hedgeRatio: number;          // Current hedge ratio [0, 1]
  hedgePosition: number;       // Hedge position size
  trailStopPrice: number;      // Trailing stop price
  trailStopDistance: number;   // ATR-based trailing distance
  peakPnL: number;             // Peak unrealized PnL (for profit locking)
  lockedProfit: number;        // Locked profit amount
}

// ─── Agent Output ───────────────────────────────────────────────────────────

export interface ProtectAgentState {
  action: ProtectAction;
  actionLabel: string;
  confidence: number;
  policyProbs: number[];
  value: number;              // Critic's value estimate
  // Grid/Martingale status
  gridMartingale: GridMartingaleState;
  // Training stats
  totalTrainSteps: number;
  lastActorLoss: number;
  lastCriticLoss: number;
  avgReward: number;
  episodeReward: number;
}

// ─── Config ─────────────────────────────────────────────────────────────────

export interface ProtectAgentConfig {
  learningRate: number;
  gamma: number;            // Discount factor
  entropyBeta: number;      // Entropy regularization
  nSteps: number;           // N-step returns
  trainEveryTicks: number;  // Train interval
  // Reward shaping
  drawdownPenaltyScale: number;  // Heavy penalty for drawdown
  profitLockReward: number;      // Reward for locking profits
  hedgeSuccessReward: number;    // Reward for successful hedge
  martingaleRecoveryReward: number;
  martingaleFailPenalty: number; // Heavy penalty for failed martingale
  // Grid/Martingale limits
  gridMaxLevels: number;
  gridSpacingATR: number;     // Grid spacing in ATR multiples
  martingaleMax: number;      // Max doublings
  trailStopATR: number;       // Trail stop distance in ATR multiples
}

const DEFAULT_CONFIG: ProtectAgentConfig = {
  learningRate: 0.0002,
  gamma: 0.97,
  entropyBeta: 0.02,
  nSteps: 10,
  trainEveryTicks: 50,
  drawdownPenaltyScale: 5.0,
  profitLockReward: 2.0,
  hedgeSuccessReward: 1.5,
  martingaleRecoveryReward: 3.0,
  martingaleFailPenalty: 10.0,
  gridMaxLevels: 5,
  gridSpacingATR: 1.0,
  martingaleMax: 3,
  trailStopATR: 2.0,
};

// ─── Experience buffer for N-step returns ───────────────────────────────────

interface ProtectExperience {
  state: number[];
  action: number;
  reward: number;
  value: number;
}

// ─── Agent ──────────────────────────────────────────────────────────────────

let protectInstanceCount = 0;

class A3CProtectAgent {
  private config: ProtectAgentConfig;
  private actorModel: tf.LayersModel;
  private criticModel: tf.LayersModel;
  private optimizer: tf.Optimizer;
  private scopeName: string;

  // Grid / Martingale state
  private gmState: GridMartingaleState;

  // Training buffer
  private trajectory: ProtectExperience[] = [];
  private trainSteps: number = 0;
  private tickCount: number = 0;

  // Running stats
  private lastActorLoss: number = 0;
  private lastCriticLoss: number = 0;
  private rewardEma: number = 0;
  private episodeReward: number = 0;
  private consecutiveLosses: number = 0;
  private winCount: number = 0;
  private tradeCount: number = 0;
  private prevPnL: number = 0;
  private isTraining: boolean = false;

  // Current inference
  private currentAction: ProtectAction = ProtectAction.HOLD;
  private currentConfidence: number = 0;
  private currentProbs: number[] = new Array(PROTECT_ACTION_SIZE).fill(1 / PROTECT_ACTION_SIZE);
  private currentValue: number = 0;

  constructor(config?: Partial<ProtectAgentConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scopeName = `a3cp_${++protectInstanceCount}_${Date.now()}`;
    this.optimizer = tf.train.adam(this.config.learningRate);

    this.actorModel = this.buildActor();
    this.criticModel = this.buildCritic();

    this.gmState = this.initGridMartingale();
  }

  // ─── Build Actor (policy) network ─────────────────────────────────────

  private buildActor(): tf.LayersModel {
    const pfx = `${this.scopeName}_act_`;
    const input = tf.input({ shape: [PROTECT_STATE_DIM], name: `${pfx}in` });
    const d1 = tf.layers.dense({ name: `${pfx}d1`, units: 128, activation: 'relu', kernelInitializer: 'heNormal' }).apply(input);
    const d2 = tf.layers.dense({ name: `${pfx}d2`, units: 64, activation: 'relu' }).apply(d1 as tf.SymbolicTensor);
    const d3 = tf.layers.dense({ name: `${pfx}d3`, units: 32, activation: 'relu' }).apply(d2 as tf.SymbolicTensor);
    const out = tf.layers.dense({ name: `${pfx}out`, units: PROTECT_ACTION_SIZE, activation: 'softmax' }).apply(d3 as tf.SymbolicTensor);
    const model = tf.model({ inputs: input, outputs: out as tf.SymbolicTensor });
    model.compile({ optimizer: this.optimizer, loss: 'categoricalCrossentropy' });
    return model;
  }

  // ─── Build Critic (value) network ─────────────────────────────────────

  private buildCritic(): tf.LayersModel {
    const pfx = `${this.scopeName}_crt_`;
    const input = tf.input({ shape: [PROTECT_STATE_DIM], name: `${pfx}in` });
    const d1 = tf.layers.dense({ name: `${pfx}d1`, units: 128, activation: 'relu', kernelInitializer: 'heNormal' }).apply(input);
    const d2 = tf.layers.dense({ name: `${pfx}d2`, units: 64, activation: 'relu' }).apply(d1 as tf.SymbolicTensor);
    const d3 = tf.layers.dense({ name: `${pfx}d3`, units: 32, activation: 'relu' }).apply(d2 as tf.SymbolicTensor);
    const out = tf.layers.dense({ name: `${pfx}out`, units: 1 }).apply(d3 as tf.SymbolicTensor);
    const model = tf.model({ inputs: input, outputs: out as tf.SymbolicTensor });
    model.compile({ optimizer: this.optimizer, loss: 'meanSquaredError' });
    return model;
  }

  // ─── Initialize Grid/Martingale state ─────────────────────────────────

  private initGridMartingale(): GridMartingaleState {
    return {
      gridOrders: [],
      gridSpacing: 0,
      gridMaxLevels: this.config.gridMaxLevels,
      martingaleCount: 0,
      martingaleMaxCount: this.config.martingaleMax,
      hedgeRatio: 0,
      hedgePosition: 0,
      trailStopPrice: 0,
      trailStopDistance: 0,
      peakPnL: 0,
      lockedProfit: 0,
    };
  }

  // ─── Main tick: observe → act → learn ─────────────────────────────────

  tick(
    portfolio: PortfolioState,
    technicals: TechnicalState | null | undefined,
    circuitBreaker: CircuitBreakerState | null | undefined,
    rlTrainer: RLTrainerState | null | undefined,
    price: number,
    atr: number,
    priceChanges: { pct5: number; pct20: number; pct50: number },
    spread: number,
    volumeRoc: number,
  ): ProtectAgentState {
    this.tickCount++;

    // Build state vector
    const state = this.buildState(
      portfolio, technicals, circuitBreaker, rlTrainer,
      price, atr, priceChanges, spread, volumeRoc,
    );

    // Compute reward from previous action
    const reward = this.computeReward(portfolio, atr);

    // Store experience
    if (this.trajectory.length > 0) {
      this.trajectory[this.trajectory.length - 1].reward = reward;
    }

    // Infer action
    this.infer(state);

    // Add current step to trajectory
    this.trajectory.push({
      state,
      action: this.currentAction,
      reward: 0, // will be filled on next tick
      value: this.currentValue,
    });

    // Execute action side effects (grid/martingale/hedge/trail management)
    this.executeAction(this.currentAction, portfolio, price, atr);

    // Train periodically
    if (this.tickCount % this.config.trainEveryTicks === 0 && this.trajectory.length >= this.config.nSteps) {
      this.train();
    }

    this.prevPnL = portfolio.unrealizedPnl + portfolio.dailyPnl;

    return this.getState();
  }

  // ─── Build state vector ───────────────────────────────────────────────

  private buildState(
    portfolio: PortfolioState,
    tech: TechnicalState | null | undefined,
    cb: CircuitBreakerState | null | undefined,
    rl: RLTrainerState | null | undefined,
    price: number,
    atr: number,
    priceChanges: { pct5: number; pct20: number; pct50: number },
    spread: number,
    volumeRoc: number,
  ): number[] {
    const s = new Array<number>(PROTECT_STATE_DIM).fill(0);
    const safeATR = Math.max(atr, price * 0.0001);

    // Portfolio (0-7)
    s[0] = Math.max(-1, Math.min(1, portfolio.position));
    s[1] = portfolio.position > 0 ? 1 : portfolio.position < 0 ? -1 : 0;
    s[2] = portfolio.unrealizedPnl / Math.max(Math.abs(portfolio.dailyPnl), safeATR * 100);
    s[3] = portfolio.dailyPnl / (safeATR * 100);
    s[4] = portfolio.maxDrawdownToday / (safeATR * 100);
    s[5] = portfolio.marginUtilization;
    s[6] = Math.min(1, portfolio.timeInTradeSec / 3600);
    s[7] = portfolio.availableRiskBudget;

    // Risk metrics (8-12)
    s[8] = (cb?.level ?? 0) / 3;
    s[9] = Math.min(1, this.consecutiveLosses / 5);
    const currentPnL = portfolio.unrealizedPnl + portfolio.dailyPnl;
    s[10] = this.gmState.peakPnL > 0 ? (this.gmState.peakPnL - currentPnL) / (safeATR * 100) : 0;
    s[11] = this.gmState.peakPnL > 0 ? this.gmState.lockedProfit / this.gmState.peakPnL : 0;
    s[12] = this.tradeCount > 0 ? this.winCount / this.tradeCount : 0.5;

    // Market conditions (13-20)
    s[13] = tech?.atr.percentile ?? 0.5;
    s[14] = (tech?.adx.adx ?? 0) / 100;
    s[15] = ((tech?.adx.pdi ?? 0) - (tech?.adx.mdi ?? 0)) / 100;
    s[16] = (tech?.rsi.value ?? 50) / 100;
    s[17] = tech?.bollingerBands.percentB ?? 0.5;
    s[18] = tech?.bollingerBands.squeeze ? 1 : 0;
    s[19] = tech?.macd.aligned === 'bullish' ? 1 : tech?.macd.aligned === 'bearish' ? -1 : 0;
    s[20] = (tech?.stochastic.k ?? 50) / 100;

    // Trend & momentum (21-25)
    s[21] = priceChanges.pct5;
    s[22] = priceChanges.pct20;
    s[23] = priceChanges.pct50;
    s[24] = spread / safeATR;
    s[25] = volumeRoc;

    // RL signal (26-27)
    s[26] = rl ? (rl.currentAction === 4 ? 1 : rl.currentAction === 3 ? 0.5 : rl.currentAction === 0 ? -1 : rl.currentAction === 1 ? -0.5 : 0) : 0;
    s[27] = rl?.currentConfidence ?? 0;

    // Hedge/Grid state (28-31)
    s[28] = this.gmState.hedgeRatio;
    s[29] = this.gmState.gridOrders.length / this.gmState.gridMaxLevels;
    s[30] = this.gmState.martingaleCount / this.gmState.martingaleMaxCount;
    s[31] = this.gmState.trailStopDistance / safeATR;

    // Clamp
    for (let i = 0; i < PROTECT_STATE_DIM; i++) {
      s[i] = Math.max(-10, Math.min(10, Number.isFinite(s[i]) ? s[i] : 0));
    }
    return s;
  }

  // ─── Inference ────────────────────────────────────────────────────────

  private infer(state: number[]): void {
    const input = tf.tensor2d([state]);

    // Actor: policy probabilities
    const policyTensor = this.actorModel.predict(input) as tf.Tensor;
    const probs = Array.from(policyTensor.dataSync());

    // Critic: state value
    const valueTensor = this.criticModel.predict(input) as tf.Tensor;
    this.currentValue = valueTensor.dataSync()[0];

    input.dispose();
    policyTensor.dispose();
    valueTensor.dispose();

    this.currentProbs = probs;

    // Sample action from policy (with safety masking)
    const maskedProbs = this.maskUnsafeActions(probs);
    this.currentAction = this.sampleFromPolicy(maskedProbs);
    this.currentConfidence = maskedProbs[this.currentAction];
  }

  // ─── Mask unsafe actions based on current state ───────────────────────

  private maskUnsafeActions(probs: number[]): number[] {
    const masked = [...probs];

    // Can't martingale if at max count or no position
    if (this.gmState.martingaleCount >= this.gmState.martingaleMaxCount) {
      masked[ProtectAction.MARTINGALE_DOUBLE] = 0;
    }

    // Can't grid if at max levels
    if (this.gmState.gridOrders.length >= this.gmState.gridMaxLevels) {
      masked[ProtectAction.GRID_ENTRY] = 0;
    }

    // Can't hedge if already fully hedged
    if (this.gmState.hedgeRatio >= 0.99) {
      masked[ProtectAction.HEDGE_PARTIAL] = 0;
      masked[ProtectAction.HEDGE_FULL] = 0;
    }

    // Can't trail stop if no position
    if (this.gmState.peakPnL <= 0) {
      masked[ProtectAction.TRAIL_STOP] = 0;
    }

    // Renormalize
    const sum = masked.reduce((s, p) => s + p, 0);
    if (sum > 0) {
      for (let i = 0; i < masked.length; i++) masked[i] /= sum;
    } else {
      // Fallback to HOLD
      masked.fill(0);
      masked[ProtectAction.HOLD] = 1;
    }

    return masked;
  }

  private sampleFromPolicy(probs: number[]): ProtectAction {
    const rand = Math.random();
    let cumulative = 0;
    for (let i = 0; i < probs.length; i++) {
      cumulative += probs[i];
      if (rand <= cumulative) return i as ProtectAction;
    }
    return ProtectAction.HOLD;
  }

  // ─── Execute action side effects ──────────────────────────────────────

  private executeAction(action: ProtectAction, portfolio: PortfolioState, price: number, atr: number): void {
    const safeATR = Math.max(atr, price * 0.0001);

    switch (action) {
      case ProtectAction.HEDGE_PARTIAL:
        this.gmState.hedgeRatio = Math.min(1, this.gmState.hedgeRatio + 0.5);
        this.gmState.hedgePosition = portfolio.position * -this.gmState.hedgeRatio;
        break;

      case ProtectAction.HEDGE_FULL:
        this.gmState.hedgeRatio = 1.0;
        this.gmState.hedgePosition = -portfolio.position;
        break;

      case ProtectAction.GRID_ENTRY:
        if (this.gmState.gridOrders.length < this.gmState.gridMaxLevels) {
          const spacing = safeATR * this.config.gridSpacingATR;
          const level = this.gmState.gridOrders.length + 1;
          const gridPrice = portfolio.position > 0
            ? price - spacing * level  // buy lower for longs
            : price + spacing * level; // sell higher for shorts
          this.gmState.gridOrders.push({
            price: gridPrice,
            size: Math.abs(portfolio.position) * 0.25, // 25% of position each level
            direction: portfolio.position > 0 ? 1 : -1,
          });
          this.gmState.gridSpacing = spacing;
        }
        break;

      case ProtectAction.MARTINGALE_DOUBLE:
        if (this.gmState.martingaleCount < this.gmState.martingaleMaxCount) {
          this.gmState.martingaleCount++;
        }
        break;

      case ProtectAction.TRAIL_STOP:
        this.gmState.trailStopDistance = safeATR * this.config.trailStopATR;
        if (portfolio.position > 0) {
          const newStop = price - this.gmState.trailStopDistance;
          this.gmState.trailStopPrice = Math.max(this.gmState.trailStopPrice, newStop);
        } else if (portfolio.position < 0) {
          const newStop = price + this.gmState.trailStopDistance;
          this.gmState.trailStopPrice = this.gmState.trailStopPrice === 0
            ? newStop
            : Math.min(this.gmState.trailStopPrice, newStop);
        }
        break;

      case ProtectAction.CLOSE_ALL:
        // Reset all grid/martingale/hedge state
        this.gmState = this.initGridMartingale();
        break;

      case ProtectAction.REDUCE_25:
      case ProtectAction.REDUCE_50:
        // Proportionally reduce grid orders
        const factor = action === ProtectAction.REDUCE_25 ? 0.75 : 0.5;
        this.gmState.gridOrders = this.gmState.gridOrders.map(o => ({
          ...o, size: o.size * factor,
        }));
        if (this.gmState.hedgePosition !== 0) {
          this.gmState.hedgePosition *= factor;
          this.gmState.hedgeRatio *= factor;
        }
        break;
    }

    // Update peak PnL tracking
    const currentPnL = portfolio.unrealizedPnl + portfolio.dailyPnl;
    if (currentPnL > this.gmState.peakPnL) {
      this.gmState.peakPnL = currentPnL;
    }

    // Update locked profit (trail stop effect)
    if (this.gmState.trailStopPrice > 0 && portfolio.position !== 0) {
      const lockableProfit = portfolio.position > 0
        ? (this.gmState.trailStopPrice - price) * Math.abs(portfolio.position)
        : (price - this.gmState.trailStopPrice) * Math.abs(portfolio.position);
      if (lockableProfit > 0) {
        this.gmState.lockedProfit = Math.max(this.gmState.lockedProfit, lockableProfit);
      }
    }

    // Check if grid orders would be filled
    this.gmState.gridOrders = this.gmState.gridOrders.filter(order => {
      const filled = order.direction === 1
        ? price <= order.price   // buy limit
        : price >= order.price;  // sell limit
      return !filled; // keep unfilled orders
    });
  }

  // ─── Reward function ──────────────────────────────────────────────────

  private computeReward(portfolio: PortfolioState, atr: number): number {
    const safeATR = Math.max(atr, 0.01);
    const currentPnL = portfolio.unrealizedPnl + portfolio.dailyPnl;
    const pnlDelta = currentPnL - this.prevPnL;
    let reward = 0;

    // 1. PnL change normalized by ATR (base reward)
    reward += pnlDelta / (safeATR * 10);

    // 2. Drawdown penalty (exponential — heavily penalize large drawdowns)
    const drawdown = portfolio.maxDrawdownToday;
    if (drawdown > 0) {
      reward -= this.config.drawdownPenaltyScale * Math.pow(drawdown / (safeATR * 100), 2);
    }

    // 3. Profit protection reward
    if (this.gmState.peakPnL > 0 && currentPnL > 0) {
      const retainedPct = currentPnL / this.gmState.peakPnL;
      if (retainedPct > 0.8) {
        reward += this.config.profitLockReward * 0.1; // bonus for keeping >80% of peak
      }
    }

    // 4. Hedge effectiveness (variance reduction)
    if (this.gmState.hedgeRatio > 0) {
      const absPnlChange = Math.abs(pnlDelta);
      const expectedUnhedged = safeATR * Math.abs(portfolio.position);
      if (absPnlChange < expectedUnhedged * 0.5) {
        reward += this.config.hedgeSuccessReward * 0.05; // hedge reduced variance
      }
    }

    // 5. Martingale outcome
    if (this.gmState.martingaleCount > 0) {
      if (pnlDelta > 0) {
        reward += this.config.martingaleRecoveryReward * 0.1; // recovery working
      } else {
        reward -= this.config.martingaleFailPenalty * 0.05 * this.gmState.martingaleCount;
      }
    }

    // 6. Trail stop reward (profit locking)
    if (this.gmState.lockedProfit > 0) {
      reward += this.config.profitLockReward * 0.05;
    }

    // 7. Safety bonus: penalize high margin utilization
    if (portfolio.marginUtilization > 0.8) {
      reward -= 0.1 * (portfolio.marginUtilization - 0.8);
    }

    // 8. Consecutive loss penalty
    if (pnlDelta < 0) {
      this.consecutiveLosses++;
      reward -= 0.01 * this.consecutiveLosses;
    } else if (pnlDelta > 0) {
      this.consecutiveLosses = 0;
    }

    // Track win/loss
    if (pnlDelta > 0) this.winCount++;
    if (pnlDelta !== 0) this.tradeCount++;

    this.episodeReward += reward;

    return reward;
  }

  // ─── A3C Training (N-step returns + advantage) ────────────────────────

  private async train(): Promise<void> {
    if (this.isTraining) return; // prevent concurrent fit() calls
    const n = this.trajectory.length;
    if (n < this.config.nSteps) return;
    this.isTraining = true;

    // Take last N steps
    const steps = this.trajectory.slice(-this.config.nSteps);

    // Compute N-step returns and advantages
    const returns: number[] = [];
    const advantages: number[] = [];
    let R = steps[steps.length - 1].value; // bootstrap from last value estimate

    for (let i = steps.length - 1; i >= 0; i--) {
      R = steps[i].reward + this.config.gamma * R;
      returns.unshift(R);
      advantages.unshift(R - steps[i].value);
    }

    // Build tensors
    const states = steps.map(s => s.state);
    const actions = steps.map(s => s.action);
    const statesTensor = tf.tensor2d(states);
    const returnsTensor = tf.tensor2d(returns.map(r => [r]));

    // ── Train Critic — MUST await before disposing tensors ────────────
    try {
      const criticHistory = await this.criticModel.fit(statesTensor, returnsTensor, { epochs: 1, verbose: 0 });
      const criticLoss = criticHistory.history.loss;
      if (Array.isArray(criticLoss) && typeof criticLoss[0] === 'number') {
        this.lastCriticLoss = criticLoss[0];
      }
    } catch (err) {
      console.warn('[A3CProtect] Critic training failed:', err);
    }

    // ── Train Actor (policy gradient with advantages) ─────────────────
    const actorPred = this.actorModel.predict(statesTensor) as tf.Tensor;
    const probsData = actorPred.arraySync() as number[][];
    actorPred.dispose();

    // Build target: increase probability of good actions, decrease bad
    const targets: number[][] = [];
    for (let i = 0; i < steps.length; i++) {
      const target = [...probsData[i]];
      const adv = advantages[i];
      const act = actions[i];

      // Policy gradient update: adjust probability proportional to advantage
      const lr = 0.1; // internal step size for target construction
      target[act] = Math.max(0.001, Math.min(0.999, target[act] + lr * adv));

      // Renormalize
      const sum = target.reduce((s, p) => s + p, 0);
      for (let j = 0; j < target.length; j++) target[j] /= sum;

      targets.push(target);
    }

    const targetsTensor = tf.tensor2d(targets);
    try {
      const actorHistory = await this.actorModel.fit(statesTensor, targetsTensor, { epochs: 1, verbose: 0 });
      const actorLoss = actorHistory.history.loss;
      if (Array.isArray(actorLoss) && typeof actorLoss[0] === 'number') {
        this.lastActorLoss = actorLoss[0];
      }
    } catch (err) {
      console.warn('[A3CProtect] Actor training failed:', err);
    }

    // Dispose tensors AFTER both fits complete
    statesTensor.dispose();
    returnsTensor.dispose();
    targetsTensor.dispose();

    // Update stats
    this.trainSteps++;
    this.rewardEma = 0.95 * this.rewardEma + 0.05 * (this.episodeReward / this.config.nSteps);

    // Trim trajectory to prevent memory growth
    if (this.trajectory.length > this.config.nSteps * 5) {
      this.trajectory = this.trajectory.slice(-this.config.nSteps * 2);
    }

    this.isTraining = false;
  }

  // ─── Public API ──────────────────────────────────────────────────────

  getState(): ProtectAgentState {
    return {
      action: this.currentAction,
      actionLabel: PROTECT_ACTION_LABELS[this.currentAction],
      confidence: this.currentConfidence,
      policyProbs: [...this.currentProbs],
      value: this.currentValue,
      gridMartingale: { ...this.gmState, gridOrders: [...this.gmState.gridOrders] },
      totalTrainSteps: this.trainSteps,
      lastActorLoss: this.lastActorLoss,
      lastCriticLoss: this.lastCriticLoss,
      avgReward: this.rewardEma,
      episodeReward: this.episodeReward,
    };
  }

  getGridMartingaleState(): GridMartingaleState {
    return { ...this.gmState, gridOrders: [...this.gmState.gridOrders] };
  }

  getAction(): ProtectAction {
    return this.currentAction;
  }

  // ─── Model Save / Load (IndexedDB) ─────────────────────────────────

  async saveModel(version?: string): Promise<string> {
    const tag = version || `v${Date.now()}`;
    await this.actorModel.save(`indexeddb://a3c-actor-${tag}`);
    await this.criticModel.save(`indexeddb://a3c-critic-${tag}`);
    if (typeof window !== 'undefined') {
      const meta = {
        tag,
        trainSteps: this.trainSteps,
        avgReward: this.rewardEma,
        episodeReward: this.episodeReward,
        lastActorLoss: this.lastActorLoss,
        lastCriticLoss: this.lastCriticLoss,
        savedAt: Date.now(),
      };
      localStorage.setItem(`a3c-meta-${tag}`, JSON.stringify(meta));
      const versions: string[] = JSON.parse(localStorage.getItem('a3c-versions') || '[]');
      if (!versions.includes(tag)) {
        versions.push(tag);
        if (versions.length > 20) versions.shift();
        localStorage.setItem('a3c-versions', JSON.stringify(versions));
      }
    }
    console.log(`[A3CProtect] Model saved: ${tag}`);
    return tag;
  }

  async loadModel(version: string): Promise<boolean> {
    try {
      const actor = await tf.loadLayersModel(`indexeddb://a3c-actor-${version}`);
      const critic = await tf.loadLayersModel(`indexeddb://a3c-critic-${version}`);
      actor.compile({ optimizer: tf.train.adam(this.config.learningRate), loss: 'categoricalCrossentropy' });
      critic.compile({ optimizer: tf.train.adam(this.config.learningRate), loss: 'meanSquaredError' });
      this.actorModel.dispose();
      this.criticModel.dispose();
      this.actorModel = actor;
      this.criticModel = critic;

      if (typeof window !== 'undefined') {
        const raw = localStorage.getItem(`a3c-meta-${version}`);
        if (raw) {
          const meta = JSON.parse(raw);
          this.trainSteps = meta.trainSteps ?? 0;
          this.rewardEma = meta.avgReward ?? 0;
          this.lastActorLoss = meta.lastActorLoss ?? 0;
          this.lastCriticLoss = meta.lastCriticLoss ?? 0;
        }
      }
      console.log(`[A3CProtect] Model loaded: ${version}`);
      return true;
    } catch (err) {
      console.warn(`[A3CProtect] Failed to load model ${version}:`, err);
      return false;
    }
  }

  static getModelVersions(): { tag: string; meta: any }[] {
    if (typeof window === 'undefined') return [];
    const versions: string[] = JSON.parse(localStorage.getItem('a3c-versions') || '[]');
    return versions.map(tag => {
      const raw = localStorage.getItem(`a3c-meta-${tag}`);
      return { tag, meta: raw ? JSON.parse(raw) : null };
    });
  }

  dispose(): void {
    this.actorModel.dispose();
    this.criticModel.dispose();
    this.trajectory = [];
  }
}

export default A3CProtectAgent;
