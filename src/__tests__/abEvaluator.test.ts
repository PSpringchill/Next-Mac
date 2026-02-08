import { describe, it, expect } from 'vitest';
import ABEvaluator from '../app/components/TradingEngine/ABEvaluator';

const makeMarketData = (price: number, i: number) => {
  const spread = price * 0.001;
  const bestBid = price - spread / 2;
  const bestAsk = price + spread / 2;
  const bids: [string, string][] = [];
  const asks: [string, string][] = [];
  for (let lvl = 0; lvl < 5; lvl++) {
    bids.push([(bestBid - lvl * 0.01).toFixed(4), (5 + Math.random() * 10).toFixed(4)]);
    asks.push([(bestAsk + lvl * 0.01).toFixed(4), (5 + Math.random() * 10).toFixed(4)]);
  }
  return {
    timestamp: Date.now() + i * 500,
    price: bestAsk,
    orderBook: { lastUpdateId: i, bids, asks },
    openInterest: { openInterest: '50000', symbol: 'BTCUSDT', time: Date.now() + i * 500 },
    fundingRate: 0,
  };
};

describe('ABEvaluator', () => {
  it('returns grid search results with bestParams and delta', () => {
    const evaluator = new ABEvaluator();
    let price = 100;
    const data = Array.from({ length: 50 }, (_, i) => {
      price += (Math.random() - 0.48) * 0.2;
      return makeMarketData(price, i);
    });
    const result = evaluator.run(data);

    expect(result.bestParams).toBeDefined();
    expect(result.bestParams.tpPct).toBeGreaterThan(0);
    expect(result.bestParams.slPct).toBeGreaterThan(0);
    expect(result.bestMetrics).toBeDefined();
    expect(result.delta).toBeDefined();
    expect(result.top5).toBeDefined();
  });
});
