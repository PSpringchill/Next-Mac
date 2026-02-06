import RiskManager from './RiskManager';
import { MarketRegime, PortfolioState } from '@tradingEngine/types';

export interface ExecutionReport {
  realizedPnl: number;
  fillPrice: number;
  midPriceAtOrder: number;
}

export interface RewardState {
  portfolio: PortfolioState;
  regime?: MarketRegime;
}

export interface RewardWeights {
  realized: number;
  unrealized: number;
  slippage: number;
  drawdown: number;
  holding: number;
  regime: number;
  sharpe: number;
}

const DEFAULT_WEIGHTS: RewardWeights = {
  realized: 0.35,
  unrealized: 0.15,
  slippage: 0.15,
  drawdown: 5.0,
  holding: 0.05,
  regime: 0.1,
  sharpe: 0.2
};

class RewardCalculator {
  private riskManager: RiskManager;
  private weights: RewardWeights;
  private fundingRate: number;
  private dt: number;
  private rollingReturns: number[] = [];

  constructor(riskManager: RiskManager, weights: Partial<RewardWeights> = {}, fundingRate: number = 0.0001, dt: number = 1) {
    this.riskManager = riskManager;
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
    this.fundingRate = fundingRate;
    this.dt = dt;
  }

  computeReward(state: RewardState, nextState: RewardState, execution: ExecutionReport, tradeDirection: number): number {
    const realized = execution.realizedPnl;
    const unrealizedDelta = nextState.portfolio.unrealizedPnl - state.portfolio.unrealizedPnl;
    const slippage = Math.abs(execution.fillPrice - execution.midPriceAtOrder);

    const drawdown = nextState.portfolio.maxDrawdownToday;
    const ddLimit = this.riskManager.getConfig().maxDrawdownFromPeak;
    const ddPenalty = Math.max(0, drawdown - ddLimit * 0.7) ** 2;

    const holding = Math.abs(nextState.portfolio.position) * this.fundingRate * this.dt;
    const regimeBonus = this.isRegimeAligned(tradeDirection, nextState.regime) ? 1 : 0;

    const sharpeContribution = this.updateSharpeContribution(realized + unrealizedDelta);

    return (
      this.weights.realized * realized +
      this.weights.unrealized * unrealizedDelta -
      this.weights.slippage * slippage -
      this.weights.drawdown * ddPenalty -
      this.weights.holding * holding +
      this.weights.regime * regimeBonus +
      this.weights.sharpe * sharpeContribution
    );
  }

  private isRegimeAligned(direction: number, regime?: MarketRegime): boolean {
    if (!regime) return false;
    const normalized = regime.momentum ?? 0;
    if (direction > 0) return normalized > 0;
    if (direction < 0) return normalized < 0;
    return false;
  }

  private updateSharpeContribution(pnl: number): number {
    this.rollingReturns.push(pnl);
    if (this.rollingReturns.length > 50) {
      this.rollingReturns.shift();
    }
    const avg = this.rollingReturns.reduce((sum, value) => sum + value, 0) / (this.rollingReturns.length || 1);
    const variance = this.rollingReturns.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (this.rollingReturns.length || 1);
    const std = Math.sqrt(variance) || 1;
    return avg / std;
  }
}

export default RewardCalculator;
