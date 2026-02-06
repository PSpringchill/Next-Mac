import { describe, it, expect } from 'vitest';
import RewardCalculator from '../app/components/TradingEngine/RewardCalculator';
import RiskManager from '../app/components/TradingEngine/RiskManager';

const riskManager = new RiskManager({ maxDrawdownFromPeak: 1000 });
const calculator = new RewardCalculator(riskManager, {}, 0.0001, 1);

const baseState = {
  portfolio: {
    position: 0.2,
    unrealizedPnl: 10,
    timeInTradeSec: 120,
    marginUtilization: 0.3,
    tradesToday: 4,
    dailyPnl: 100,
    maxDrawdownToday: 50,
    availableRiskBudget: 0.8
  },
  regime: { name: 'trending_up', volatility: 0.2, momentum: 0.1 }
};

describe('RewardCalculator', () => {
  it('returns a numeric reward', () => {
    const reward = calculator.computeReward(
      baseState,
      { ...baseState, portfolio: { ...baseState.portfolio, unrealizedPnl: 12 } },
      { realizedPnl: 5, fillPrice: 100, midPriceAtOrder: 99 },
      1
    );
    expect(Number.isFinite(reward)).toBe(true);
  });

  it('penalizes drawdown beyond limit', () => {
    const reward = calculator.computeReward(
      baseState,
      { ...baseState, portfolio: { ...baseState.portfolio, maxDrawdownToday: 1200 } },
      { realizedPnl: 0, fillPrice: 100, midPriceAtOrder: 100 },
      1
    );
    expect(reward).toBeLessThan(0);
  });
});
