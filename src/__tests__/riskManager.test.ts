import { describe, it, expect } from 'vitest';
import RiskManager from '../app/components/TradingEngine/RiskManager';

const createRiskManager = () => new RiskManager({
  maxDailyLoss: 1000,
  killSwitchDailyLoss: 2000,
  maxPositionSize: 1,
  maxNotionalExposure: 10000,
  maxOrdersPerMinute: 3,
  killSwitchVolatility: 4
});

describe('RiskManager', () => {
  it('blocks trades when daily loss exceeds limit', () => {
    const riskManager = createRiskManager();
    riskManager.updatePortfolioState({ dailyPnl: -1500 });
    const result = riskManager.evaluateTrade({ direction: 1, size: 0.2, price: 50000 });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(' ')).toContain('Daily loss limit');
  });

  it('activates kill switch on volatility spike', () => {
    const riskManager = createRiskManager();
    const result = riskManager.evaluateTrade(
      { direction: 1, size: 0.2, price: 50000 },
      { volatility: 5 }
    );
    expect(result.allowed).toBe(false);
    expect(result.killSwitchActivated).toBe(true);
  });

  it('caps order rate within limits', () => {
    const riskManager = createRiskManager();
    const trade = { direction: 1 as const, size: 0.2, price: 50000, timestamp: Date.now() };

    riskManager.evaluateTrade(trade);
    riskManager.evaluateTrade(trade);
    riskManager.evaluateTrade(trade);

    const result = riskManager.evaluateTrade(trade);
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(' ')).toContain('Order rate limit');
  });

  it('computes position size between 0 and 1', () => {
    const riskManager = createRiskManager();
    const size = riskManager.computePositionSize({
      winRate: 0.6,
      avgWin: 2,
      avgLoss: 1,
      confidence: 0.8,
      regime: { name: 'trending_up', volatility: 0.2, momentum: 0.1 }
    });
    expect(size).toBeGreaterThanOrEqual(0);
    expect(size).toBeLessThanOrEqual(1);
  });
});
