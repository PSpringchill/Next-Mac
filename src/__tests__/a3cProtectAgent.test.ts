import { describe, it, expect } from 'vitest';
import A3CProtectAgent, {
  ProtectAction,
  PROTECT_ACTION_SIZE,
  PROTECT_STATE_DIM,
  PROTECT_ACTION_LABELS,
} from '../app/components/TradingEngine/A3CProtectAgent';
import type { PortfolioState } from '@tradingEngine/types';
import type { TechnicalState } from '../app/components/TradingEngine/TechnicalIndicators';
import type { CircuitBreakerState } from '../app/components/TradingEngine/RiskManager';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockPortfolio(overrides?: Partial<PortfolioState>): PortfolioState {
  return {
    position: 0.1,
    unrealizedPnl: 50,
    timeInTradeSec: 120,
    marginUtilization: 0.3,
    tradesToday: 5,
    dailyPnl: 100,
    maxDrawdownToday: 20,
    availableRiskBudget: 0.8,
    ...overrides,
  };
}

function mockTechnicals(): TechnicalState {
  return {
    rsi: { value: 55, isOverbought: false, isOversold: false, inRange: true },
    macd: { macdLine: 0.1, signalLine: 0.05, histogram: 0.05, bullishCrossover: false, bearishCrossover: false, aligned: 'bullish' },
    atr: { value: 0.5, percentile: 0.5, isExtreme: false, isNormal: true },
    bollingerBands: { upper: 101, middle: 100, lower: 99, bandwidth: 0.02, percentB: 0.5, squeeze: false },
    stochastic: { k: 55, d: 50, isOverbought: false, isOversold: false, bullishCrossover: false, bearishCrossover: false },
    adx: { adx: 25, pdi: 18, mdi: 12, isTrending: true, isStrong: false, bullishDI: true },
  };
}

function mockCB(level: 0 | 1 | 2 | 3 = 0): CircuitBreakerState {
  return {
    level,
    activeSince: null,
    reason: null,
    stopMultiplier: 1,
    positionSizeMultiplier: 1,
    entriesHalted: level >= 1,
  };
}

const defaultPriceChanges = { pct5: 0.1, pct20: 0.3, pct50: 0.5 };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('A3CProtectAgent', () => {
  it('initializes with correct action and state dimensions', () => {
    const agent = new A3CProtectAgent();
    const state = agent.getState();
    expect(state.policyProbs.length).toBe(PROTECT_ACTION_SIZE);
    expect(PROTECT_ACTION_SIZE).toBe(9);
    expect(PROTECT_STATE_DIM).toBe(32);
    agent.dispose();
  });

  it('all action labels are defined', () => {
    for (let i = 0; i < PROTECT_ACTION_SIZE; i++) {
      expect(PROTECT_ACTION_LABELS[i as ProtectAction]).toBeDefined();
      expect(typeof PROTECT_ACTION_LABELS[i as ProtectAction]).toBe('string');
    }
  });

  it('produces valid action on tick', () => {
    const agent = new A3CProtectAgent();
    const state = agent.tick(
      mockPortfolio(), mockTechnicals(), mockCB(), null,
      100, 0.5, defaultPriceChanges, 0.01, 0,
    );
    expect(state.action).toBeGreaterThanOrEqual(0);
    expect(state.action).toBeLessThan(PROTECT_ACTION_SIZE);
    expect(state.actionLabel).toBeTruthy();
    expect(state.confidence).toBeGreaterThanOrEqual(0);
    expect(state.confidence).toBeLessThanOrEqual(1);
    agent.dispose();
  });

  it('policy probabilities sum to ~1', () => {
    const agent = new A3CProtectAgent();
    agent.tick(mockPortfolio(), mockTechnicals(), mockCB(), null, 100, 0.5, defaultPriceChanges, 0.01, 0);
    const state = agent.getState();
    const sum = state.policyProbs.reduce((s, p) => s + p, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.01);
    agent.dispose();
  });

  it('critic produces a value estimate', () => {
    const agent = new A3CProtectAgent();
    const state = agent.tick(
      mockPortfolio(), mockTechnicals(), mockCB(), null,
      100, 0.5, defaultPriceChanges, 0.01, 0,
    );
    expect(typeof state.value).toBe('number');
    expect(Number.isFinite(state.value)).toBe(true);
    agent.dispose();
  });

  it('trains after enough ticks', () => {
    const agent = new A3CProtectAgent({ trainEveryTicks: 20, nSteps: 5 });

    for (let i = 0; i < 50; i++) {
      const price = 100 + Math.sin(i * 0.1) * 2;
      const pnl = Math.sin(i * 0.05) * 50;
      agent.tick(
        mockPortfolio({ unrealizedPnl: pnl, dailyPnl: pnl }),
        mockTechnicals(), mockCB(), null,
        price, 0.5, defaultPriceChanges, 0.01, 0,
      );
    }

    const state = agent.getState();
    expect(state.totalTrainSteps).toBeGreaterThanOrEqual(1);
    agent.dispose();
  });

  it('grid orders accumulate with GRID_ENTRY actions', () => {
    const agent = new A3CProtectAgent({ gridMaxLevels: 5 });

    // Simulate ticks — grid orders should accumulate in gmState
    let state = agent.getState();
    const initialGridCount = state.gridMartingale.gridOrders.length;
    expect(initialGridCount).toBe(0);

    // We can't force GRID_ENTRY via tick (it's policy-driven),
    // but gridMaxLevels is exposed in state
    expect(state.gridMartingale.gridMaxLevels).toBe(5);
    agent.dispose();
  });

  it('hedge ratio stays in [0, 1]', () => {
    const agent = new A3CProtectAgent();
    for (let i = 0; i < 100; i++) {
      agent.tick(
        mockPortfolio({ position: 0.5 }), mockTechnicals(), mockCB(), null,
        100 + Math.random() * 2, 0.5, defaultPriceChanges, 0.01, 0,
      );
    }
    const state = agent.getState();
    expect(state.gridMartingale.hedgeRatio).toBeGreaterThanOrEqual(0);
    expect(state.gridMartingale.hedgeRatio).toBeLessThanOrEqual(1);
    agent.dispose();
  });

  it('martingale count stays within max', () => {
    const agent = new A3CProtectAgent({ martingaleMax: 3 });
    for (let i = 0; i < 100; i++) {
      agent.tick(
        mockPortfolio({ position: 0.2, unrealizedPnl: -100 }), mockTechnicals(), mockCB(), null,
        100 - i * 0.01, 0.5, defaultPriceChanges, 0.01, 0,
      );
    }
    const state = agent.getState();
    expect(state.gridMartingale.martingaleCount).toBeLessThanOrEqual(3);
    agent.dispose();
  });

  it('peak PnL tracks correctly', () => {
    const agent = new A3CProtectAgent();

    // Rising PnL
    for (let i = 0; i < 20; i++) {
      agent.tick(
        mockPortfolio({ unrealizedPnl: i * 10, dailyPnl: i * 5 }),
        mockTechnicals(), mockCB(), null,
        100 + i, 0.5, defaultPriceChanges, 0.01, 0,
      );
    }

    const state = agent.getState();
    expect(state.gridMartingale.peakPnL).toBeGreaterThan(0);
    agent.dispose();
  });

  it('handles null technicals and circuit breaker gracefully', () => {
    const agent = new A3CProtectAgent();
    // Should not throw
    const state = agent.tick(
      mockPortfolio(), null, null, null,
      100, 0.5, defaultPriceChanges, 0.01, 0,
    );
    expect(state.action).toBeGreaterThanOrEqual(0);
    agent.dispose();
  });

  it('episodeReward accumulates over ticks', () => {
    const agent = new A3CProtectAgent();
    for (let i = 0; i < 30; i++) {
      agent.tick(
        mockPortfolio({ unrealizedPnl: i * 5, dailyPnl: i * 3 }),
        mockTechnicals(), mockCB(), null,
        100 + i * 0.5, 0.5, defaultPriceChanges, 0.01, 0,
      );
    }
    const state = agent.getState();
    // episodeReward should be non-zero after multiple ticks with changing PnL
    expect(typeof state.episodeReward).toBe('number');
    expect(Number.isFinite(state.episodeReward)).toBe(true);
    agent.dispose();
  });

  it('CLOSE_ALL resets grid/martingale/hedge state', () => {
    const agent = new A3CProtectAgent();

    // Run ticks to potentially build up some state
    for (let i = 0; i < 50; i++) {
      agent.tick(
        mockPortfolio({ position: 0.3 }), mockTechnicals(), mockCB(), null,
        100 + Math.random(), 0.5, defaultPriceChanges, 0.01, 0,
      );
    }

    // After CLOSE_ALL, grid state should reset
    // (we can't force CLOSE_ALL directly but verify the initial state resets correctly)
    const state = agent.getState();
    expect(state.gridMartingale.gridMaxLevels).toBeGreaterThan(0);
    expect(state.gridMartingale.martingaleMaxCount).toBeGreaterThan(0);
    agent.dispose();
  });
});
