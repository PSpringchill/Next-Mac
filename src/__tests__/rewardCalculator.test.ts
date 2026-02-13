import { describe, it, expect } from 'vitest';
import RewardCalculator from '../app/components/TradingEngine/RewardCalculator';
import type { RewardBreakdown } from '../app/components/TradingEngine/RewardCalculator';
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
    const calc = new RewardCalculator(riskManager, {}, 0.0001, 1, { ddSoft: 0.0 });
    const reward = calc.computeReward(
      { portfolio: baseState.portfolio, equityPrev: 100000 },
      { portfolio: { ...baseState.portfolio, maxDrawdownToday: 10000 }, equityNext: 90000 },
      { realizedPnl: 0, fillPrice: 100, midPriceAtOrder: 100 },
      1
    );
    expect(reward).toBeLessThan(0);
  });

  // ─── Multi-layer reward architecture tests ──────────────────────────────

  it('uses log-returns when equity is provided', () => {
    const calc = new RewardCalculator(riskManager);
    const r = calc.computeReward(
      { portfolio: baseState.portfolio, equityPrev: 100000 },
      { portfolio: { ...baseState.portfolio, unrealizedPnl: 20 }, equityNext: 100010 },
      { realizedPnl: 10, fillPrice: 100, midPriceAtOrder: 100 },
      1
    );
    expect(Number.isFinite(r)).toBe(true);
    const bd = calc.getLastBreakdown();
    expect(bd).not.toBeNull();
    expect(bd!.logReturn).toBeCloseTo(Math.log(100010 / 100000), 5);
  });

  it('applies flip penalty on direction reversal', () => {
    const calc = new RewardCalculator(riskManager);
    // First trade: buy
    calc.computeReward(
      { portfolio: baseState.portfolio, equityPrev: 100000 },
      { portfolio: baseState.portfolio, equityNext: 100005 },
      { realizedPnl: 5, fillPrice: 100, midPriceAtOrder: 100 },
      1 // BUY
    );
    // Second trade: sell (flip)
    calc.computeReward(
      { portfolio: baseState.portfolio, equityPrev: 100005 },
      { portfolio: baseState.portfolio, equityNext: 100000 },
      { realizedPnl: -5, fillPrice: 100, midPriceAtOrder: 100 },
      -1 // SELL (direction flip)
    );
    const bd = calc.getLastBreakdown();
    expect(bd!.isFlip).toBe(true);
    expect(bd!.friction).toBeLessThan(0); // friction should be negative due to flip
  });

  it('nonlinear drawdown: 10% is 4x worse than 5% (beyond soft threshold)', () => {
    const calc = new RewardCalculator(riskManager, {}, 0.0001, 1, { ddSoft: 0.0 });
    // 5% drawdown
    calc.computeReward(
      { portfolio: baseState.portfolio, equityPrev: 100000 },
      { portfolio: { ...baseState.portfolio, maxDrawdownToday: 5000 }, equityNext: 95000 },
      { realizedPnl: 0, fillPrice: 100, midPriceAtOrder: 100 },
      1
    );
    const bd5 = calc.getLastBreakdown()!;

    const calc2 = new RewardCalculator(riskManager, {}, 0.0001, 1, { ddSoft: 0.0 });
    // 10% drawdown
    calc2.computeReward(
      { portfolio: baseState.portfolio, equityPrev: 100000 },
      { portfolio: { ...baseState.portfolio, maxDrawdownToday: 10000 }, equityNext: 90000 },
      { realizedPnl: 0, fillPrice: 100, midPriceAtOrder: 100 },
      1
    );
    const bd10 = calc2.getLastBreakdown()!;

    // Squared penalty: 10%^2 / 5%^2 = 4x
    expect(Math.abs(bd10.survival)).toBeGreaterThan(Math.abs(bd5.survival) * 3);
  });

  it('margin penalty grows exponentially as utilization approaches 1.0', () => {
    // Use low kappa so penalties don't both saturate the clamp at 100
    const calc = new RewardCalculator(riskManager, {}, 0.0001, 1, { kappa: 2.0, lambda_margin: 1.0 });
    // Low margin (just above 0.3 threshold)
    calc.computeReward(
      { portfolio: baseState.portfolio, equityPrev: 100000 },
      { portfolio: { ...baseState.portfolio, marginUtilization: 0.35 }, equityNext: 100000 },
      { realizedPnl: 0, fillPrice: 100, midPriceAtOrder: 100 },
      1
    );
    const bdLow = calc.getLastBreakdown()!;

    // High margin
    calc.computeReward(
      { portfolio: baseState.portfolio, equityPrev: 100000 },
      { portfolio: { ...baseState.portfolio, marginUtilization: 0.9 }, equityNext: 100000 },
      { realizedPnl: 0, fillPrice: 100, midPriceAtOrder: 100 },
      1
    );
    const bdHigh = calc.getLastBreakdown()!;

    // Exponential: 0.9 margin util should produce much larger penalty than 0.35
    expect(Math.abs(bdHigh.constraint)).toBeGreaterThan(Math.abs(bdLow.constraint) * 3);
  });

  it('regime scaling dampens alpha during crisis', () => {
    const calc = new RewardCalculator(riskManager);
    // Crisis regime: volatile state dominant
    const crisisSoftRegime = {
      regime: { name: 'volatile', volatility: 0.05, momentum: 0, isTransition: false },
      probabilities: [0.05, 0.05, 0.05, 0.80, 0.05], // volatile dominant
      stateNames: ['trending_up', 'trending_down', 'ranging', 'volatile', 'breakout'],
      entropy: 0.8,
      dominantProb: 0.8,
    };
    calc.computeReward(
      { portfolio: baseState.portfolio, equityPrev: 100000, softRegime: crisisSoftRegime },
      { portfolio: { ...baseState.portfolio, unrealizedPnl: 20 }, equityNext: 100010, softRegime: crisisSoftRegime },
      { realizedPnl: 10, fillPrice: 100, midPriceAtOrder: 100 },
      1
    );
    const bdCrisis = calc.getLastBreakdown()!;
    expect(bdCrisis.regimeScale).toBeLessThan(1.0); // dampened

    // Trend regime
    const trendSoftRegime = {
      regime: { name: 'trending_up', volatility: 0.02, momentum: 1, isTransition: false },
      probabilities: [0.80, 0.05, 0.05, 0.05, 0.05],
      stateNames: ['trending_up', 'trending_down', 'ranging', 'volatile', 'breakout'],
      entropy: 0.5,
      dominantProb: 0.8,
    };
    calc.computeReward(
      { portfolio: baseState.portfolio, equityPrev: 100000, softRegime: trendSoftRegime },
      { portfolio: { ...baseState.portfolio, unrealizedPnl: 20 }, equityNext: 100010, softRegime: trendSoftRegime },
      { realizedPnl: 10, fillPrice: 100, midPriceAtOrder: 100 },
      1
    );
    const bdTrend = calc.getLastBreakdown()!;
    expect(bdTrend.regimeScale).toBeGreaterThan(1.0); // boosted
  });

  it('reward is clamped to [-10, 10]', () => {
    const calc = new RewardCalculator(riskManager);
    // Extreme case
    const r = calc.computeReward(
      { portfolio: baseState.portfolio, equityPrev: 1 },
      { portfolio: { ...baseState.portfolio, maxDrawdownToday: 999999, marginUtilization: 0.99 }, equityNext: 1000000 },
      { realizedPnl: 100000, fillPrice: 100, midPriceAtOrder: 1 },
      1
    );
    expect(r).toBeGreaterThanOrEqual(-10);
    expect(r).toBeLessThanOrEqual(10);
  });

  it('getCoefficients returns defaults', () => {
    const calc = new RewardCalculator(riskManager);
    const c = calc.getCoefficients();
    expect(c.lambda_pnl).toBe(1.0);
    expect(c.lambda_dd).toBe(5.0);
    expect(c.ddSoft).toBe(0.04);
    expect(c.kappa).toBe(15.0);
    expect(c.lambda_flip).toBe(0.5);
  });

  it('updateCoefficients modifies behavior', () => {
    const calc = new RewardCalculator(riskManager);
    calc.updateCoefficients({ lambda_flip: 10.0 });
    expect(calc.getCoefficients().lambda_flip).toBe(10.0);
  });
});
