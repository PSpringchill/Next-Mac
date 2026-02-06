import { describe, it, expect } from 'vitest';
import StressTestHarness from '../app/components/TradingEngine/StressTestHarness';

const makeData = () => [{
  timestamp: Date.now(),
  price: 100,
  orderBook: {
    lastUpdateId: 1,
    bids: [['99.5', '1'] as [string, string]],
    asks: [['100.5', '1'] as [string, string]]
  },
  openInterest: {
    openInterest: '1000',
    symbol: 'BTCUSDT',
    time: Date.now()
  },
  fundingRate: 0.0001
}];

describe('StressTestHarness', () => {
  it('runs flash crash scenario', async () => {
    const harness = new StressTestHarness();
    const result = await harness.runScenario('basic', makeData() as any);
    expect(result.scenario).toBe('basic');
  });
});
