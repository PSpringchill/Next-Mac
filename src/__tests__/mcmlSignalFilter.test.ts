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

function makeMarketData(price: number) {
  return {
    timestamp: Date.now(),
    price,
    orderBook: {
      lastUpdateId: 1,
      bids: Array.from({ length: 10 }, (_, i) => [
        String(price - 1 - i * 0.1),
        String(1 + Math.random())
      ] as [string, string]),
      asks: Array.from({ length: 10 }, (_, i) => [
        String(price + 1 + i * 0.1),
        String(1 + Math.random())
      ] as [string, string]),
    },
    openInterest: {
      openInterest: '1000',
      symbol: 'BTCUSDT',
      time: Date.now()
    },
    fundingRate: 0.0001
  };
}

describe('MCML Signal Filter Integration', () => {
  it('feedMonitoringData returns signalFilter on first tick', async () => {
    const riskManager = new RiskManager({
      maxPositionSize: 1000,
      maxNotionalExposure: 1e9,
      maxDailyLoss: 1e9
    });
    const engine = new PaperTradingEngine(stubEngine as any, riskManager);
    const md = makeMarketData(100);
    const result = await engine.feedMonitoringData(md as any);

    expect(result.signalFilter).toBeDefined();
    expect(result.signalFilter).not.toBeNull();
    expect(result.signalFilter!.gradientSurprise).toBeDefined();
    expect(result.signalFilter!.gradientSurprise.gradientNorm).toBeGreaterThanOrEqual(0);
    expect(typeof result.signalFilter!.hmmRegime).toBe('string');
  });

  it('feedMonitoringData returns HMM regime after enough ticks', async () => {
    const riskManager = new RiskManager({
      maxPositionSize: 1000,
      maxNotionalExposure: 1e9,
      maxDailyLoss: 1e9
    });
    const engine = new PaperTradingEngine(stubEngine as any, riskManager);

    // Feed 15 ticks (HMM fires every 10 ticks, counter starts at 9)
    let lastResult: any;
    for (let i = 0; i < 15; i++) {
      const md = makeMarketData(100 + i * 0.1);
      lastResult = await engine.feedMonitoringData(md as any);
    }

    expect(lastResult.signalFilter).toBeDefined();
    // After 15 ticks, HMM should have fired at least once
    expect(lastResult.signalFilter!.hmmRegime).not.toBe('initializing');
    expect(['trending_up', 'trending_down', 'ranging', 'volatile', 'breakout']).toContain(
      lastResult.signalFilter!.hmmRegime
    );
  });

  it('processTick returns signalFilter with filtered confidence', async () => {
    const riskManager = new RiskManager({
      maxPositionSize: 1000,
      maxNotionalExposure: 1e9,
      maxDailyLoss: 1e9
    });
    const engine = new PaperTradingEngine(stubEngine as any, riskManager);

    // Prime with monitoring data first (as LiveExecutionBridge does)
    for (let i = 0; i < 12; i++) {
      await engine.feedMonitoringData(makeMarketData(100 + i * 0.1) as any);
    }

    const result = await engine.processTick(makeMarketData(101.5) as any);

    expect(result.signalFilter).toBeDefined();
    expect(result.signalFilter!.originalConfidence).toBe(0.9);
    expect(result.signalFilter!.filteredConfidence).toBeGreaterThan(0);
    expect(result.signalFilter!.filteredConfidence).toBeLessThanOrEqual(1.0);
    expect(typeof result.signalFilter!.hmmRegime).toBe('string');
  });

  it('GradientSurpriseMonitor tracks signal oscillation', async () => {
    // Create engine with alternating buy/sell signals to trigger flip detection
    let callCount = 0;
    const oscillatingEngine = {
      processMarketData: async () => {
        callCount++;
        return {
          direction: callCount % 2 === 0 ? 1 : -1,
          strength: 0.8,
          confidence: 0.5 + Math.random() * 0.4,
          timestamp: Date.now()
        };
      }
    };

    const riskManager = new RiskManager({
      maxPositionSize: 1000,
      maxNotionalExposure: 1e9,
      maxDailyLoss: 1e9
    });
    const engine = new PaperTradingEngine(oscillatingEngine as any, riskManager);

    // Feed many ticks to build up flip history
    let lastResult: any;
    for (let i = 0; i < 60; i++) {
      await engine.feedMonitoringData(makeMarketData(100 + Math.sin(i) * 2) as any);
      lastResult = await engine.processTick(makeMarketData(100 + Math.sin(i) * 2) as any);
    }

    // After 60 oscillating signals, gradient surprise should be elevated
    expect(lastResult.signalFilter).toBeDefined();
    expect(lastResult.signalFilter!.gradientSurprise.directionFlipRate).toBeGreaterThan(0);
  });

  it('signalFilter blocked field reflects gate decisions', async () => {
    const riskManager = new RiskManager({
      maxPositionSize: 1000,
      maxNotionalExposure: 1e9,
      maxDailyLoss: 1e9
    });
    const engine = new PaperTradingEngine(stubEngine as any, riskManager);

    const md = makeMarketData(100);
    const result = await engine.feedMonitoringData(md as any);

    // On first tick, should not be blocked (no data yet)
    expect(result.signalFilter!.blocked).toBe(false);
    expect(typeof result.signalFilter!.blocked).toBe('boolean');
  });
});
