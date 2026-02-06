import { describe, it, expect } from 'vitest';
import ABEvaluator from '../app/components/TradingEngine/ABEvaluator';

const makeMarketData = () => ({
  timestamp: Date.now(),
  price: 100,
  orderBook: {
    lastUpdateId: 1,
    bids: [['99', '1'] as [string, string]],
    asks: [['101', '1'] as [string, string]]
  },
  openInterest: {
    openInterest: '1200',
    symbol: 'BTCUSDT',
    time: Date.now()
  },
  fundingRate: 0.002
});

describe('ABEvaluator', () => {
  it('returns baseline and mdp results with deltas', async () => {
    const evaluator = new ABEvaluator();
    const data = [makeMarketData(), makeMarketData()];
    const result = await evaluator.run(data as any);

    expect(result.baseline).toBeDefined();
    expect(result.mdp).toBeDefined();
    expect(result.delta).toBeDefined();
  });
});
