import { describe, it, expect } from 'vitest';
import ExecutionEngine from '../app/components/TradingEngine/ExecutionEngine';
import RiskManager from '../app/components/TradingEngine/RiskManager';

const orderBook = {
  lastUpdateId: 1,
  bids: [
    ['100', '1'] as [string, string],
    ['99.5', '2'] as [string, string]
  ],
  asks: [
    ['100.5', '1'] as [string, string],
    ['101', '2'] as [string, string]
  ]
};

describe('ExecutionEngine', () => {
  it('rejects invalid order requests', () => {
    const engine = new ExecutionEngine();
    const report = engine.executeOrder({ direction: 0, size: 0, urgency: 0.5 }, orderBook);
    expect(report.status).toBe('rejected');
  });

  it('routes passive execution with low urgency', () => {
    const engine = new ExecutionEngine();
    const report = engine.executeOrder({ direction: 1, size: 0.1, urgency: 0.1 }, orderBook);
    expect(report.mode).toBe('passive');
    expect(report.childOrders).toBe(1);
  });

  it('routes adaptive execution with mid urgency', () => {
    const engine = new ExecutionEngine();
    const report = engine.executeOrder({ direction: -1, size: 0.5, urgency: 0.5 }, orderBook);
    expect(report.mode).toBe('adaptive');
    expect(report.childOrders).toBeGreaterThanOrEqual(3);
  });

  it('respects risk manager rejection', () => {
    const riskManager = new RiskManager({ maxDailyLoss: 100, maxPositionSize: 0.1 });
    riskManager.updatePortfolioState({ dailyPnl: -200 });
    const engine = new ExecutionEngine(riskManager);
    const report = engine.executeOrder({ direction: 1, size: 0.2, urgency: 0.9 }, orderBook);
    expect(report.status).toBe('rejected');
  });
});
