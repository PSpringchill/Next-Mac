import { describe, it, expect } from 'vitest';
import PaperTradingEngine from '../app/components/TradingEngine/PaperTradingEngine';
import RiskManager from '../app/components/TradingEngine/RiskManager';

const stubEngine = {
  processMarketData: async () => ({
    direction: 1,
    strength: 0.8,
    confidence: 0.9,
    timestamp: Date.now()
  })
};

const marketData = {
  timestamp: Date.now(),
  price: 100,
  orderBook: {
    lastUpdateId: 1,
    bids: [['99', '1'] as [string, string], ['98', '2'] as [string, string]],
    asks: [['101', '1'] as [string, string], ['102', '2'] as [string, string]]
  },
  openInterest: {
    openInterest: '1000',
    symbol: 'BTCUSDT',
    time: Date.now()
  },
  fundingRate: 0.0001
};

describe('PaperTradingEngine', () => {
  it('emits a trade result when signal confidence is high', async () => {
    const riskManager = new RiskManager({
      maxPositionSize: 1000,
      maxNotionalExposure: 1e9,
      maxDailyLoss: 1e9
    });
    const engine = new PaperTradingEngine(stubEngine as any, riskManager);
    const result = await engine.processTick(marketData as any);

    expect(result.signal.confidence).toBeGreaterThan(0.7);
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.portfolio.position).toBeGreaterThanOrEqual(0);
  });
});
