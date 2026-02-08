import { describe, it, expect } from 'vitest';
import ABEvaluator from '../app/components/TradingEngine/ABEvaluator';
import GridSearchOptimizer, { runTPSLBacktest, computeOBI } from '../app/components/TradingEngine/GridSearchOptimizer';
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

describe('GridSearchOptimizer', () => {
  it('computeOBI returns values in -100..+100 range', () => {
    const data = generateSyntheticData(10);
    for (const tick of data) {
      const obi = computeOBI(tick.orderBook);
      expect(obi).toBeGreaterThanOrEqual(-100);
      expect(obi).toBeLessThanOrEqual(100);
    }
  });

  it('runTPSLBacktest produces trades with reasonable params', () => {
    const data = generateSyntheticData(200);
    const result = runTPSLBacktest(data, { tpPct: 0.1, slPct: 0.05, entryObi: 5 });

    console.log('TPSL backtest: trades =', result.trades.length, 'return =', result.totalReturn, 'winRate =', result.winRate);
    expect(result.trades.length).toBeGreaterThan(0);
  });

  it('grid search finds best params from 200 ticks', () => {
    const data = generateSyntheticData(200);
    const optimizer = new GridSearchOptimizer();
    const result = optimizer.run(data);

    console.log('=== GRID SEARCH ===');
    console.log('Combinations:', result.totalCombinations);
    console.log('Elapsed:', result.elapsed.toFixed(0), 'ms');
    console.log('Best TP:', result.best.tpPct, 'SL:', result.best.slPct, 'OBI:', result.best.entryObi);
    console.log('Best score:', result.best.score.toFixed(2));
    console.log('Best return:', (result.bestMetrics.totalReturn * 100).toFixed(3) + '%');
    console.log('Best winRate:', (result.bestMetrics.winRate * 100).toFixed(1) + '%');
    console.log('Best sharpe:', result.bestMetrics.sharpeRatio.toFixed(2));

    expect(result.totalCombinations).toBe(8 * 7 * 6); // 336 combos
    expect(result.best.tpPct).toBeGreaterThan(0);
    expect(result.best.slPct).toBeGreaterThan(0);
    expect(result.best.score).toBeGreaterThan(-Infinity);
  });
});

describe('ABEvaluator — grid search', () => {
  it('returns best params and delta vs median', () => {
    const data = generateSyntheticData(200);
    const evaluator = new ABEvaluator();
    const result = evaluator.run(data);

    console.log('=== AB EVALUATOR (Grid Search) ===');
    console.log('Best: TP', result.bestParams.tpPct, 'SL', result.bestParams.slPct, 'OBI', result.bestParams.entryObi);
    console.log('Delta return:', (result.delta.totalReturn * 100).toFixed(3) + '%');
    console.log('Top 5:');
    result.top5.forEach((r, i) => {
      console.log(`  #${i + 1} TP=${r.params.tpPct} SL=${r.params.slPct} OBI=${r.params.entryObi} ret=${(r.metrics.totalReturn * 100).toFixed(3)}% WR=${(r.metrics.winRate * 100).toFixed(0)}%`);
    });

    expect(result.bestParams.tpPct).toBeGreaterThan(0);
    expect(result.bestParams.slPct).toBeGreaterThan(0);
    expect(result.top5.length).toBe(5);
  });
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
