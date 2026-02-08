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
    const rv = new RadarVector({ bufferSize: 50, minDataPoints: 20, cooldownTicks: 200 });
    for (let i = 0; i < 60; i++) {
      rv.feed(makeTick(100 + Math.sin(i * 0.1) * 5));
    }
    const state = rv.getState();
    expect(state.dataPoints).toBeLessThanOrEqual(50);
  });

  it('does NOT run search when allConditionsMet is false and within fallback interval', () => {
    const rv = new RadarVector({
      bufferSize: 200,
      minDataPoints: 30,
      cooldownTicks: 10,
      fallbackInterval: 9999, // disable fallback for this test
    });
    // Feed 60 ticks but never signal conditions met
    for (let i = 0; i < 60; i++) {
      rv.feed(makeTick(100 + Math.sin(i * 0.2) * 3, 10, 10), false);
    }
    expect(rv.getState().searchCount).toBe(0);
  });

  it('runs search via fallback when allConditionsMet stays false long enough', () => {
    const rv = new RadarVector({
      bufferSize: 300,
      minDataPoints: 30,
      cooldownTicks: 10,
      fallbackInterval: 50,
    });
    // Feed 55 ticks without conditions met — exceeds fallbackInterval
    for (let i = 0; i < 55; i++) {
      rv.feed(makeTick(100 + Math.sin(i * 0.2) * 3, 10 + i % 5, 8 + i % 3), false);
    }
    const state = rv.getState();
    expect(state.searchCount).toBeGreaterThanOrEqual(1);
    expect(['ESTABLISH', 'NO VECTOR']).toContain(state.status);
  });

  it('runs grid search when allConditionsMet is true and data is sufficient', () => {
    const rv = new RadarVector({
      bufferSize: 200,
      minDataPoints: 30,
      cooldownTicks: 10,
    });
    // Feed 40 ticks without conditions met
    for (let i = 0; i < 40; i++) {
      const price = 100 + Math.sin(i * 0.2) * 3 + Math.random() * 0.5;
      rv.feed(makeTick(price, 10 + i % 5, 8 + i % 3), false);
    }
    expect(rv.getState().searchCount).toBe(0);
    // Now signal conditions met
    const state = rv.feed(makeTick(102, 12, 8), true);
    expect(state.searchCount).toBeGreaterThanOrEqual(1);
    expect(state.totalCombinations).toBeGreaterThan(0);
    expect(state.lastSearchMs).toBeGreaterThanOrEqual(0);
    expect(['ESTABLISH', 'NO VECTOR']).toContain(state.status);
  });

  it('produces valid parameter values when search completes', () => {
    const rv = new RadarVector({
      bufferSize: 200,
      minDataPoints: 30,
      cooldownTicks: 10,
    });
    for (let i = 0; i < 40; i++) {
      rv.feed(makeTick(100 + Math.sin(i * 0.15) * 4, 10, 10), false);
    }
    rv.feed(makeTick(102, 10, 10), true); // trigger search
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
      cooldownTicks: 999, // won't auto-trigger
    });
    for (let i = 0; i < 50; i++) {
      rv.feed(makeTick(100 + i * 0.2, 12, 8));
    }
    expect(rv.getState().searchCount).toBe(0);
    const state = rv.forceSearch();
    expect(state.searchCount).toBe(1);
  });

  it('reset clears all state', () => {
    const rv = new RadarVector({ minDataPoints: 20, cooldownTicks: 10 });
    for (let i = 0; i < 30; i++) {
      rv.feed(makeTick(100 + i * 0.1), false);
    }
    rv.feed(makeTick(105), true); // trigger a search
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
    expect(config.cooldownTicks).toBe(50);
    expect(config.fallbackInterval).toBe(200);
    expect(config.sharpeThreshold).toBe(1.0);
    expect(config.winRateThreshold).toBe(0.50);
  });

  it('ESTABLISH status requires both sharpe and winRate thresholds', () => {
    // Use very strict thresholds that are hard to meet
    const rv = new RadarVector({
      bufferSize: 200,
      minDataPoints: 30,
      cooldownTicks: 10,
      sharpeThreshold: 99.0,   // impossible
      winRateThreshold: 0.99,  // near impossible
    });
    for (let i = 0; i < 40; i++) {
      rv.feed(makeTick(100 + Math.random(), 10, 10), false);
    }
    const state = rv.feed(makeTick(101, 10, 10), true); // trigger search
    if (state.searchCount > 0) {
      expect(state.status).toBe('NO VECTOR');
    }
  });

  it('respects cooldown between searches', () => {
    const rv = new RadarVector({
      bufferSize: 200,
      minDataPoints: 30,
      cooldownTicks: 20,
      fallbackInterval: 9999,
    });
    // Feed 35 ticks then trigger first search
    for (let i = 0; i < 35; i++) {
      rv.feed(makeTick(100 + i * 0.1, 12, 8), false);
    }
    rv.feed(makeTick(105, 12, 8), true);
    expect(rv.getState().searchCount).toBe(1);
    // Immediately try again — should be blocked by cooldown
    rv.feed(makeTick(106, 12, 8), true);
    expect(rv.getState().searchCount).toBe(1); // still 1
    // Feed enough ticks to pass cooldown
    for (let i = 0; i < 20; i++) {
      rv.feed(makeTick(100 + i * 0.05, 12, 8), false);
    }
    rv.feed(makeTick(107, 12, 8), true);
    expect(rv.getState().searchCount).toBe(2);
  });
});
