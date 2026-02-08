import { describe, it, expect, beforeEach } from 'vitest';
import LOBBacktester from '../app/components/TradingEngine/LOBBacktester';
import type { LOBDataPoint } from '../app/components/TradingEngine/LOBBacktester';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeLOBData(nPoints: number, basePrice: number = 10000): LOBDataPoint[] {
  const data: LOBDataPoint[] = [];
  let price = basePrice;
  const startTime = 0;

  for (let i = 0; i < nPoints; i++) {
    const drift = Math.sin(i / 50) * 0.0005;
    const noise = (Math.random() - 0.5) * 0.001;
    price *= (1 + drift + noise);

    const spread = price * 0.0002;
    const bestBid = price - spread / 2;
    const bestAsk = price + spread / 2;

    const bids: [string, string][] = [];
    const asks: [string, string][] = [];
    for (let level = 0; level < 10; level++) {
      bids.push([
        (bestBid - level * spread * 0.5).toFixed(2),
        ((1 + level * 0.3 + Math.random()) * 10).toFixed(4),
      ]);
      asks.push([
        (bestAsk + level * spread * 0.5).toFixed(2),
        ((1 + level * 0.3 + Math.random()) * 10).toFixed(4),
      ]);
    }

    data.push({
      timestamp: startTime + i * 1000,
      orderBook: { lastUpdateId: i, bids, asks },
      price,
    });
  }

  return data;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LOBBacktester', () => {
  let backtester: LOBBacktester;

  beforeEach(() => {
    backtester = new LOBBacktester({
      trainWindowMs: 60_000,   // 1 minute for faster tests
      testWindowMs: 10_000,    // 10 seconds
      stepMs: 10_000,
      initialCapital: 100_000,
      positionSizePct: 2,
      commissionPct: 0.04,
      slippageBps: 1,
    });
  });

  describe('generateSyntheticData()', () => {
    it('generates requested number of data points', () => {
      const data = backtester.generateSyntheticData('BTCUSDT', 500, 10000, 0.001);
      expect(data.length).toBe(500);
    });

    it('generates valid order book structure', () => {
      const data = backtester.generateSyntheticData('BTCUSDT', 10);
      for (const d of data) {
        expect(d.orderBook.bids.length).toBe(20);
        expect(d.orderBook.asks.length).toBe(20);
        expect(d.price).toBeGreaterThan(0);
        expect(d.timestamp).toBeGreaterThan(0);
      }
    });

    it('generates chronologically ordered timestamps', () => {
      const data = backtester.generateSyntheticData('BTCUSDT', 100);
      for (let i = 1; i < data.length; i++) {
        expect(data[i].timestamp).toBeGreaterThan(data[i - 1].timestamp);
      }
    });

    it('bid prices are below ask prices', () => {
      const data = backtester.generateSyntheticData('BTCUSDT', 50);
      for (const d of data) {
        const bestBid = parseFloat(d.orderBook.bids[0][0]);
        const bestAsk = parseFloat(d.orderBook.asks[0][0]);
        expect(bestBid).toBeLessThan(bestAsk);
      }
    });
  });

  describe('runBacktest()', () => {
    it('throws with insufficient data', async () => {
      await expect(backtester.runBacktest([])).rejects.toThrow();
      await expect(backtester.runBacktest(makeLOBData(5))).rejects.toThrow();
    });

    it('runs backtest on sufficient data and returns results', async () => {
      const data = makeLOBData(200);
      const results = await backtester.runBacktest(data);

      expect(results).toBeDefined();
      expect(typeof results.totalReturn).toBe('number');
      expect(typeof results.sharpeRatio).toBe('number');
      expect(typeof results.maxDrawdown).toBe('number');
      expect(typeof results.winRate).toBe('number');
      expect(results.equityCurve.length).toBeGreaterThanOrEqual(1);
    });

    it('equity curve starts at initial capital', async () => {
      const data = makeLOBData(200);
      const results = await backtester.runBacktest(data);
      expect(results.equityCurve[0]).toBe(100_000);
    });

    it('report string is non-empty', async () => {
      const data = makeLOBData(200);
      const results = await backtester.runBacktest(data);
      expect(results.report.length).toBeGreaterThan(100);
      expect(results.report).toContain('BACKTEST REPORT');
    });

    it('tracks model usage count', async () => {
      const data = makeLOBData(200);
      const results = await backtester.runBacktest(data);
      const totalUsage = Object.values(results.modelUsageCount).reduce((s, v) => s + v, 0);
      expect(totalUsage).toBe(results.windows.length);
    });

    it('totalPnl matches equity curve delta', async () => {
      const data = makeLOBData(200);
      const results = await backtester.runBacktest(data);
      const equityDelta = results.equityCurve[results.equityCurve.length - 1] - results.equityCurve[0];
      expect(results.totalPnl).toBeCloseTo(equityDelta, 2);
    });

    it('winRate is between 0 and 1', async () => {
      const data = makeLOBData(200);
      const results = await backtester.runBacktest(data);
      expect(results.winRate).toBeGreaterThanOrEqual(0);
      expect(results.winRate).toBeLessThanOrEqual(1);
    });

    it('maxDrawdown is non-negative', async () => {
      const data = makeLOBData(200);
      const results = await backtester.runBacktest(data);
      expect(results.maxDrawdown).toBeGreaterThanOrEqual(0);
      expect(results.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    });
  });

  describe('window results', () => {
    it('each window has valid metrics', async () => {
      const data = makeLOBData(200);
      const results = await backtester.runBacktest(data);

      for (const w of results.windows) {
        expect(w.trainSamples).toBeGreaterThan(0);
        expect(w.testSamples).toBeGreaterThan(0);
        expect(w.testAccuracy).toBeGreaterThanOrEqual(0);
        expect(w.testAccuracy).toBeLessThanOrEqual(1);
        expect(w.modelUsed).toBeTruthy();
      }
    });

    it('train and test windows are chronologically ordered', async () => {
      const data = makeLOBData(200);
      const results = await backtester.runBacktest(data);

      for (const w of results.windows) {
        expect(w.trainEnd).toBeGreaterThan(w.trainStart);
        expect(w.testStart).toBeGreaterThanOrEqual(w.trainEnd);
        expect(w.testEnd).toBeGreaterThan(w.testStart);
      }
    });
  });
});
