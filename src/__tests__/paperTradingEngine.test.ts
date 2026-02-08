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
  it('processes tick and produces ensemble + signal filter state', async () => {
    const riskManager = new RiskManager({
      maxPositionSize: 1000,
      maxNotionalExposure: 1e9,
      maxDailyLoss: 1e9
    });
    const engine = new PaperTradingEngine(stubEngine as any, riskManager);
    const result = await engine.processTick(marketData as any);

    // Signal should exist with high confidence from stub engine
    expect(result.signal.confidence).toBeGreaterThan(0.7);
    // Ensemble result should be present with component checks
    expect(result.ensemble).toBeDefined();
    expect(result.ensemble!.checks.length).toBe(7); // 7 component checks
    expect(result.ensemble!.ensembleScore).toBeGreaterThanOrEqual(0);
    expect(result.ensemble!.ensembleScore).toBeLessThanOrEqual(1);
    // Signal filter should contain Kalman, LinReg, NaiveBayes, and ensemble
    expect(result.signalFilter).toBeDefined();
    expect(result.signalFilter!.kalman).toBeDefined();
    expect(result.signalFilter!.linReg).toBeDefined();
    expect(result.signalFilter!.naiveBayes).toBeDefined();
    expect(result.signalFilter!.ensemble).toBeDefined();
    // Portfolio should start at initial state
    expect(result.portfolio.position).toBeGreaterThanOrEqual(0);
  });

  it('does not enter when ensemble conditions are not all met', async () => {
    const riskManager = new RiskManager({
      maxPositionSize: 1000,
      maxNotionalExposure: 1e9,
      maxDailyLoss: 1e9
    });
    const engine = new PaperTradingEngine(stubEngine as any, riskManager);
    // Single tick — ensemble needs many aligned conditions, so no trade expected
    const result = await engine.processTick(marketData as any);
    // Without enough price history for Kalman/LinReg/NaiveBayes to converge,
    // the ensemble gate should NOT produce a trade
    expect(result.ensemble!.allConditionsMet).toBe(false);
    expect(result.trades.length).toBe(0);
  });
});
