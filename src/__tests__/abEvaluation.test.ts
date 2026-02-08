import { describe, it, expect } from 'vitest';
import ABEvaluator from '../app/components/TradingEngine/ABEvaluator';
import StressTestHarness from '../app/components/TradingEngine/StressTestHarness';
import { MarketData } from '@tradingEngine/types';

/**
 * Generate synthetic market data that mimics real recorded ticks.
 * Creates a realistic order book with bid/ask spreads and varying imbalances.
 */
function generateSyntheticData(count: number): MarketData[] {
  const data: MarketData[] = [];
  let price = 600; // BNB-like price

  for (let i = 0; i < count; i++) {
    // Random walk with slight upward drift
    const change = (Math.random() - 0.48) * 0.5;
    price = Math.max(500, price + change);

    const spread = 0.01 + Math.random() * 0.05;
    const bestBid = price - spread / 2;
    const bestAsk = price + spread / 2;

    // Generate 10 levels of depth with varying imbalance
    const imbalanceBias = Math.sin(i * 0.1) * 0.5; // oscillating imbalance
    const bids: [string, string][] = [];
    const asks: [string, string][] = [];

    for (let lvl = 0; lvl < 10; lvl++) {
      const bidPrice = bestBid - lvl * 0.01;
      const askPrice = bestAsk + lvl * 0.01;
      const baseBidVol = 5 + Math.random() * 20 + (imbalanceBias > 0 ? imbalanceBias * 10 : 0);
      const baseAskVol = 5 + Math.random() * 20 + (imbalanceBias < 0 ? Math.abs(imbalanceBias) * 10 : 0);
      bids.push([bidPrice.toFixed(4), baseBidVol.toFixed(4)]);
      asks.push([askPrice.toFixed(4), baseAskVol.toFixed(4)]);
    }

    data.push({
      timestamp: Date.now() + i * 500,
      price: bestAsk,
      orderBook: {
        bids,
        asks,
        lastUpdateId: i,
      },
      openInterest: {
        openInterest: (50000 + Math.random() * 1000).toFixed(2),
        symbol: 'BNBUSDT',
        time: Date.now() + i * 500,
      },
      fundingRate: 0,
    });
  }
  return data;
}

describe('ABEvaluator — end-to-end', () => {
  it('produces non-zero delta metrics with 200 ticks of synthetic data', async () => {
    const data = generateSyntheticData(200);
    const evaluator = new ABEvaluator();
    const result = await evaluator.run(data);

    console.log('=== A/B EVALUATION RESULT ===');
    console.log('Baseline trades:', result.baseline.trades.length);
    result.baseline.trades.forEach((t, i) => console.log(`  B[${i}] ${t.type} sz=${t.size.toFixed(4)} px=${t.price.toFixed(2)} pnl=${t.pnl?.toFixed(4)}`));
    console.log('Baseline return:', result.baseline.totalReturn);
    console.log('Baseline sharpe:', result.baseline.sharpeRatio);
    console.log('Baseline drawdown:', result.baseline.maxDrawdown);
    console.log('Baseline winRate:', result.baseline.winRate);
    console.log('---');
    console.log('MDP trades:', result.mdp.trades.length);
    result.mdp.trades.forEach((t, i) => console.log(`  M[${i}] ${t.type} sz=${t.size.toFixed(4)} px=${t.price.toFixed(2)} pnl=${t.pnl?.toFixed(4)}`));
    console.log('MDP return:', result.mdp.totalReturn);
    console.log('MDP sharpe:', result.mdp.sharpeRatio);
    console.log('MDP drawdown:', result.mdp.maxDrawdown);
    console.log('MDP winRate:', result.mdp.winRate);
    console.log('---');
    console.log('Delta return:', result.delta.totalReturn);
    console.log('Delta sharpe:', result.delta.sharpeRatio);
    console.log('Delta drawdown:', result.delta.maxDrawdown);
    console.log('Delta winRate:', result.delta.winRate);

    // At least one engine should have executed trades
    const totalTrades = result.baseline.trades.length + result.mdp.trades.length;
    expect(totalTrades).toBeGreaterThan(0);

    // At least one delta metric should be non-zero
    const anyNonZero =
      result.delta.totalReturn !== 0 ||
      result.delta.sharpeRatio !== 0 ||
      result.delta.maxDrawdown !== 0 ||
      result.delta.winRate !== 0;
    expect(anyNonZero).toBe(true);
  }, 30000);

  it('baseline engine produces trades with realistic order book data', async () => {
    const data = generateSyntheticData(100);
    const evaluator = new ABEvaluator();
    const result = await evaluator.run(data);

    console.log('Baseline trades with 100 ticks:', result.baseline.trades.length);
    console.log('MDP trades with 100 ticks:', result.mdp.trades.length);

    // Baseline should have at least some trades from the oscillating imbalance
    expect(result.baseline.trades.length).toBeGreaterThan(0);
  }, 30000);
});

describe('StressTestHarness — end-to-end', () => {
  it('flash crash scenario produces results', async () => {
    const harness = new StressTestHarness();
    const result = await harness.runFlashCrash();

    console.log('=== FLASH CRASH ===');
    console.log('Scenario:', result.scenario);
    console.log('Trades:', result.trades.length);
    console.log('Max Drawdown:', result.maxDrawdown);
    console.log('Final PnL:', result.finalPnl);

    expect(result.scenario).toBe('flash_crash');
    expect(result.trades).toBeDefined();
  }, 15000);

  it('all 3 stress scenarios complete', async () => {
    const harness = new StressTestHarness();
    const [crash, api, stale] = await Promise.all([
      harness.runFlashCrash(),
      harness.runApiFailure(),
      harness.runStaleFeed(),
    ]);

    console.log('Flash crash trades:', crash.trades.length, 'PnL:', crash.finalPnl);
    console.log('API failure trades:', api.trades.length, 'PnL:', api.finalPnl);
    console.log('Stale feed trades:', stale.trades.length, 'PnL:', stale.finalPnl);

    expect(crash.scenario).toBe('flash_crash');
    expect(api.scenario).toBe('api_failure');
    expect(stale.scenario).toBe('stale_feed');
  }, 15000);
});
