import { describe, it, expect } from 'vitest';
import RadarVector from '../app/components/TradingEngine/RadarVector';
import type { MarketData } from '@tradingEngine/types';

function makeTick(price: number, bidVol: number = 10, askVol: number = 10, ts?: number): MarketData {
  return {
    timestamp: ts ?? Date.now(),
    price,
    orderBook: {
      lastUpdateId: 1,
      bids: [[String(price - 0.5), String(bidVol)] as [string, string], [String(price - 1), '5'] as [string, string]],
      asks: [[String(price + 0.5), String(askVol)] as [string, string], [String(price + 1), '5'] as [string, string]],
    },
    openInterest: { openInterest: '1000', symbol: 'BTCUSDT', time: Date.now() },
    fundingRate: 0.0001,
  };
}

describe('RadarVector', () => {
  it('starts in SCANNING status', () => {
    const rv = new RadarVector();
    const state = rv.feed(makeTick(100));
    expect(state.status).toBe('SCANNING');
    expect(state.searchCount).toBe(0);
    expect(state.dataPoints).toBe(1);
  });

  it('accumulates data points up to bufferSize', () => {
    const rv = new RadarVector({ bufferSize: 50, minDataPoints: 20, searchIntervalTicks: 200 });
    for (let i = 0; i < 60; i++) {
      rv.feed(makeTick(100 + Math.sin(i * 0.1) * 5));
    }
    const state = rv.getState();
    expect(state.dataPoints).toBeLessThanOrEqual(50);
  });

  it('runs grid search after collecting enough data', () => {
    const rv = new RadarVector({
      bufferSize: 200,
      minDataPoints: 30,
      searchIntervalTicks: 30,
    });
    // Feed 60 ticks — should trigger at least one search (at tick 30)
    let state;
    for (let i = 0; i < 60; i++) {
      const price = 100 + Math.sin(i * 0.2) * 3 + Math.random() * 0.5;
      state = rv.feed(makeTick(price, 10 + i % 5, 8 + i % 3));
    }
    expect(state!.searchCount).toBeGreaterThanOrEqual(1);
    expect(state!.totalCombinations).toBeGreaterThan(0);
    expect(state!.lastSearchMs).toBeGreaterThanOrEqual(0);
    expect(['ESTABLISH', 'NO VECTOR']).toContain(state!.status);
  });

  it('produces valid parameter values when search completes', () => {
    const rv = new RadarVector({
      bufferSize: 200,
      minDataPoints: 30,
      searchIntervalTicks: 30,
    });
    for (let i = 0; i < 60; i++) {
      rv.feed(makeTick(100 + Math.sin(i * 0.15) * 4, 10, 10));
    }
    const state = rv.getState();
    if (state.searchCount > 0) {
      expect(state.tpPct).toBeGreaterThanOrEqual(0);
      expect(state.slPct).toBeGreaterThanOrEqual(0);
      expect(state.entryObi).toBeGreaterThanOrEqual(0);
      expect(state.drawdownPct).toBeGreaterThanOrEqual(0);
      expect(state.sharpe).toBeDefined();
      expect(state.winRate).toBeGreaterThanOrEqual(0);
      expect(state.winRate).toBeLessThanOrEqual(1);
    }
  });

  it('getEstablishedParams returns null when not ESTABLISH', () => {
    const rv = new RadarVector();
    rv.feed(makeTick(100));
    expect(rv.getEstablishedParams()).toBeNull();
    expect(rv.isEstablished()).toBe(false);
  });

  it('forceSearch works with sufficient data', () => {
    const rv = new RadarVector({
      bufferSize: 200,
      minDataPoints: 20,
      searchIntervalTicks: 999, // won't auto-trigger
    });
    for (let i = 0; i < 50; i++) {
      rv.feed(makeTick(100 + i * 0.2, 12, 8));
    }
    expect(rv.getState().searchCount).toBe(0);
    const state = rv.forceSearch();
    expect(state.searchCount).toBe(1);
  });

  it('reset clears all state', () => {
    const rv = new RadarVector({ minDataPoints: 20, searchIntervalTicks: 20 });
    for (let i = 0; i < 40; i++) {
      rv.feed(makeTick(100 + i * 0.1));
    }
    rv.reset();
    const state = rv.getState();
    expect(state.status).toBe('SCANNING');
    expect(state.dataPoints).toBe(0);
    expect(state.searchCount).toBe(0);
  });

  it('config defaults match specification', () => {
    const rv = new RadarVector();
    const config = rv.getConfig();
    expect(config.bufferSize).toBe(500);
    expect(config.minDataPoints).toBe(100);
    expect(config.searchIntervalTicks).toBe(100);
    expect(config.sharpeThreshold).toBe(1.0);
    expect(config.winRateThreshold).toBe(0.50);
  });

  it('ESTABLISH status requires both sharpe and winRate thresholds', () => {
    // Use very strict thresholds that are hard to meet
    const rv = new RadarVector({
      bufferSize: 200,
      minDataPoints: 30,
      searchIntervalTicks: 30,
      sharpeThreshold: 99.0,   // impossible
      winRateThreshold: 0.99,  // near impossible
    });
    for (let i = 0; i < 60; i++) {
      rv.feed(makeTick(100 + Math.random(), 10, 10));
    }
    const state = rv.getState();
    if (state.searchCount > 0) {
      expect(state.status).toBe('NO VECTOR');
    }
  });
});
