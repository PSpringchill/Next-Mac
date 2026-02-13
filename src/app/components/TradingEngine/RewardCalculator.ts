import RiskManager from './RiskManager';
import { MarketRegime, PortfolioState } from '@tradingEngine/types';
import type { SoftRegimeOutput } from './HiddenMarkovModel';

export interface ExecutionReport {
  realizedPnl: number;
  fillPrice: number;
  midPriceAtOrder: number;
}

export interface RewardState {
  portfolio: PortfolioState;
  regime?: MarketRegime;
  equityPrev?: number;        // previous equity for log-return
  equityNext?: number;        // current equity for log-return
  softRegime?: SoftRegimeOutput | null; // soft regime probabilities for scaling
}

// ─── Multi-Layer Reward Coefficients ─────────────────────────────────────────
// Layer 1: Alpha    (Growth)      R_pnl + R_carry
// Layer 2: Friction (Efficiency)  -R_cost - R_flip
// Layer 3: Survival (Risk)        -R_vol - R_dd
// Layer 4: Constraint (Solvency)  -R_margin

export interface RewardCoefficients {
  // Alpha layer
  lambda_pnl: number;       // Log-return PnL weight
  lambda_carry: number;     // Funding carry weight
  // Friction layer
  lambda_tc: number;        // Transaction cost (slippage)
  lambda_flip: number;      // Anti-churn flip penalty
  // Survival layer
  lambda_vol: number;       // Realized volatility penalty
  lambda_dd: number;        // Nonlinear drawdown penalty
  ddSoft: number;           // Soft drawdown threshold (3-5%)
  // Constraint layer
  lambda_margin: number;    // Margin utilization penalty
  kappa: number;            // Margin penalty steepness
  // Sharpe
  lambda_sharpe: number;    // Rolling Sharpe contribution
  // Regime scaling
  regimeScalingEnabled: boolean;
}

const DEFAULT_COEFFICIENTS: RewardCoefficients = {
  lambda_pnl: 1.0,
  lambda_carry: 0.1,
  lambda_tc: 0.0005,
  lambda_flip: 0.5,
  lambda_vol: 0.25,
  lambda_dd: 5.0,
  ddSoft: 0.04,               // 4% soft threshold
  lambda_margin: 10.0,
  kappa: 15.0,
  lambda_sharpe: 0.2,
  regimeScalingEnabled: true,
};

// Legacy interface preserved for backward compatibility
export interface RewardWeights {
  realized: number;
  unrealized: number;
  slippage: number;
  drawdown: number;
  holding: number;
  regime: number;
  sharpe: number;
}

// Detailed breakdown for debugging / UI
export interface RewardBreakdown {
  alpha: number;           // R_pnl + R_carry
  friction: number;        // -R_cost - R_flip
  survival: number;        // -R_vol - R_dd
  constraint: number;      // -R_margin
  sharpe: number;          // Sharpe contribution
  regimeScale: number;     // alpha_t multiplier
  total: number;
  logReturn: number;
  isFlip: boolean;
  drawdownPct: number;
  marginUtil: number;
}

class RewardCalculator {
  private riskManager: RiskManager;
  private coeffs: RewardCoefficients;
  private fundingRate: number;
  private dt: number;
  private rollingReturns: number[] = [];
  private prevDirection: number = 0;     // track flips
  private lastBreakdown: RewardBreakdown | null = null;

  constructor(
    riskManager: RiskManager,
    weights: Partial<RewardWeights> = {},
    fundingRate: number = 0.0001,
    dt: number = 1,
    coefficients?: Partial<RewardCoefficients>,
  ) {
    this.riskManager = riskManager;
    this.fundingRate = fundingRate;
    this.dt = dt;
    this.coeffs = { ...DEFAULT_COEFFICIENTS, ...coefficients };
  }

  computeReward(
    state: RewardState,
    nextState: RewardState,
    execution: ExecutionReport,
    tradeDirection: number,
  ): number {
    // ═══ LAYER 1: ALPHA (Growth) ═════════════════════════════════════════
    // Log-return for scale invariance: ln(E_t / E_{t-1})
    const eqPrev = state.equityPrev ?? 100000;
    const eqNext = nextState.equityNext ?? (eqPrev + execution.realizedPnl +
      (nextState.portfolio.unrealizedPnl - state.portfolio.unrealizedPnl));
    const logReturn = eqPrev > 0 ? Math.log(Math.max(eqNext, 1) / Math.max(eqPrev, 1)) : 0;

    // Dense funding carry: accrued proportionally (not just at 8h marks)
    const positionValue = Math.abs(nextState.portfolio.position);
    const carry = -Math.sign(nextState.portfolio.position) * this.fundingRate * positionValue * this.dt;

    const alpha = this.coeffs.lambda_pnl * logReturn + this.coeffs.lambda_carry * carry;

    // ═══ LAYER 2: FRICTION (Efficiency) ══════════════════════════════════
    // Transaction cost: slippage penalty
    const slippage = Math.abs(execution.fillPrice - execution.midPriceAtOrder);
    const costPenalty = this.coeffs.lambda_tc * slippage;

    // Anti-gamble flip penalty: penalize direction reversals (anti-churn)
    const isFlip = this.prevDirection !== 0 &&
      tradeDirection !== 0 &&
      Math.sign(tradeDirection) !== Math.sign(this.prevDirection);
    const flipPenalty = isFlip ? this.coeffs.lambda_flip : 0;
    this.prevDirection = tradeDirection !== 0 ? tradeDirection : this.prevDirection;

    const friction = -(costPenalty + flipPenalty);

    // ═══ LAYER 3: SURVIVAL (Risk) ════════════════════════════════════════
    // Realized volatility penalty from rolling returns
    const rollingVol = this.computeRollingVol(logReturn);
    const volPenalty = this.coeffs.lambda_vol * rollingVol;

    // Nonlinear drawdown: squared penalty beyond soft threshold
    // R_dd = lambda_dd * max(0, DD - DD_soft)^2
    const riskConfig = this.riskManager.getConfig();
    const maxEquity = eqPrev > 0 ? Math.max(eqPrev, eqNext) : 100000;
    const drawdownPct = maxEquity > 0
      ? nextState.portfolio.maxDrawdownToday / maxEquity
      : 0;
    const ddExcess = Math.max(0, drawdownPct - this.coeffs.ddSoft);
    const ddPenalty = this.coeffs.lambda_dd * ddExcess * ddExcess;

    const survival = -(volPenalty + ddPenalty);

    // ═══ LAYER 4: CONSTRAINT (Solvency) ══════════════════════════════════
    // Exponential margin penalty: exp(kappa * M_t) when M_t approaches 1.0
    const marginUtil = nextState.portfolio.marginUtilization ?? 0;
    const marginPenalty = marginUtil > 0.3
      ? this.coeffs.lambda_margin * (Math.exp(this.coeffs.kappa * marginUtil) - 1)
      : 0;
    // Clamp to prevent NaN gradients
    const clampedMarginPenalty = Math.min(marginPenalty, 100);

    const constraint = -clampedMarginPenalty;

    // ═══ SHARPE CONTRIBUTION ═════════════════════════════════════════════
    const sharpe = this.coeffs.lambda_sharpe * this.updateSharpeContribution(logReturn);

    // ═══ REGIME-AWARE SCALING (alpha_t) ══════════════════════════════════
    // During crisis: scale down PnL reward, leave risk penalties at full strength
    // During trend: boost PnL reward
    let regimeScale = 1.0;
    if (this.coeffs.regimeScalingEnabled && nextState.softRegime) {
      const sr = nextState.softRegime;
      const probs = sr.probabilities;
      // Indices: 0=trending_up, 1=trending_down, 2=ranging, 3=volatile, 4=breakout
      const trendProb = (probs[0] ?? 0) + (probs[1] ?? 0);
      const crisisProb = probs[3] ?? 0; // volatile = crisis
      // In crisis: dampen alpha; in trend: boost alpha
      regimeScale = 1.0 + 0.3 * trendProb - 0.5 * crisisProb;
      regimeScale = Math.max(0.3, Math.min(1.5, regimeScale));
    } else if (nextState.regime) {
      // Fallback: binary regime alignment
      const aligned = this.isRegimeAligned(tradeDirection, nextState.regime);
      regimeScale = aligned ? 1.1 : 0.9;
    }

    // ═══ TOTAL ════════════════════════════════════════════════════════════
    const total = regimeScale * alpha + friction + survival + constraint + sharpe;

    // Clamp total reward to [-10, 10] for gradient stability
    const clamped = Math.max(-10, Math.min(10, Number.isFinite(total) ? total : 0));

    // Cache breakdown for debugging
    this.lastBreakdown = {
      alpha, friction, survival, constraint, sharpe,
      regimeScale, total: clamped, logReturn,
      isFlip, drawdownPct, marginUtil,
    };

    return clamped;
  }

  getLastBreakdown(): RewardBreakdown | null {
    return this.lastBreakdown;
  }

  getCoefficients(): RewardCoefficients {
    return { ...this.coeffs };
  }

  updateCoefficients(update: Partial<RewardCoefficients>): void {
    this.coeffs = { ...this.coeffs, ...update };
  }

  private isRegimeAligned(direction: number, regime?: MarketRegime): boolean {
    if (!regime) return false;
    const normalized = regime.momentum ?? 0;
    if (direction > 0) return normalized > 0;
    if (direction < 0) return normalized < 0;
    return false;
  }

  private computeRollingVol(logReturn: number): number {
    this.rollingReturns.push(logReturn);
    if (this.rollingReturns.length > 50) {
      this.rollingReturns.shift();
    }
    if (this.rollingReturns.length < 2) return 0;
    const n = this.rollingReturns.length;
    const avg = this.rollingReturns.reduce((s, v) => s + v, 0) / n;
    const variance = this.rollingReturns.reduce((s, v) => s + (v - avg) ** 2, 0) / n;
    return Math.sqrt(variance);
  }

  private updateSharpeContribution(logReturn: number): number {
    if (this.rollingReturns.length < 2) return 0;
    const n = this.rollingReturns.length;
    const avg = this.rollingReturns.reduce((s, v) => s + v, 0) / n;
    const variance = this.rollingReturns.reduce((s, v) => s + (v - avg) ** 2, 0) / n;
    const std = Math.sqrt(variance) || 1;
    return avg / std;
  }
}

export default RewardCalculator;
