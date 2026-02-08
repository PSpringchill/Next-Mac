import { describe, it, expect, beforeEach } from 'vitest';
import LOBFeatureExtractor, { LOBFeatures } from '../app/components/TradingEngine/LOBFeatureExtractor';
import { OrderBookData } from '@tradingEngine/types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeOrderBook(
  bids: Array<[number, number]>,
  asks: Array<[number, number]>
): OrderBookData {
  return {
    lastUpdateId: 1,
    bids: bids.map(([p, v]) => [p.toString(), v.toString()] as [string, string]),
    asks: asks.map(([p, v]) => [p.toString(), v.toString()] as [string, string]),
  };
}

const SYMMETRIC_BOOK = makeOrderBook(
  [[100, 10], [99.5, 20], [99, 30], [98.5, 40], [98, 50]],
  [[100.5, 10], [101, 20], [101.5, 30], [102, 40], [102.5, 50]]
);

const BID_HEAVY_BOOK = makeOrderBook(
  [[100, 50], [99.5, 60], [99, 70], [98.5, 80], [98, 90]],
  [[100.5, 5], [101, 10], [101.5, 15], [102, 20], [102.5, 25]]
);

const ASK_HEAVY_BOOK = makeOrderBook(
  [[100, 5], [99.5, 10], [99, 15], [98.5, 20], [98, 25]],
  [[100.5, 50], [101, 60], [101.5, 70], [102, 80], [102.5, 90]]
);

const EMPTY_BOOK: OrderBookData = { lastUpdateId: 0, bids: [], asks: [] };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LOBFeatureExtractor', () => {
  let extractor: LOBFeatureExtractor;

  beforeEach(() => {
    extractor = new LOBFeatureExtractor();
  });

  describe('extract()', () => {
    it('returns correct mid-price and spread', () => {
      const features = extractor.extract(SYMMETRIC_BOOK, 1000);
      expect(features.midPrice).toBeCloseTo(100.25, 2);
      expect(features.spread).toBeCloseTo(0.5, 2);
    });

    it('returns empty features for empty order book', () => {
      const features = extractor.extract(EMPTY_BOOK, 1000);
      expect(features.midPrice).toBe(0);
      expect(features.spread).toBe(0);
      expect(features.depthRatio1).toBe(0.5);
    });

    it('computes spreadBps correctly', () => {
      const features = extractor.extract(SYMMETRIC_BOOK, 1000);
      const expected = (0.5 / 100.25) * 10000;
      expect(features.spreadBps).toBeCloseTo(expected, 1);
    });

    it('produces valid feature vector length', () => {
      const features = extractor.extract(SYMMETRIC_BOOK, 1000);
      const vec = extractor.toFeatureVector(features);
      expect(vec.length).toBe(16);
      expect(vec.every(v => typeof v === 'number' && isFinite(v))).toBe(true);
    });
  });

  describe('Depth Ratio', () => {
    it('returns 0.5 for symmetric book', () => {
      const features = extractor.extract(SYMMETRIC_BOOK, 1000);
      expect(features.depthRatio1).toBeCloseTo(0.5, 2);
      expect(features.depthRatio5).toBeCloseTo(0.5, 2);
      expect(features.depthRatioFull).toBeCloseTo(0.5, 2);
    });

    it('returns > 0.5 for bid-heavy book', () => {
      const features = extractor.extract(BID_HEAVY_BOOK, 1000);
      expect(features.depthRatio1).toBeGreaterThan(0.5);
      expect(features.depthRatio5).toBeGreaterThan(0.5);
      expect(features.depthRatioFull).toBeGreaterThan(0.5);
    });

    it('returns < 0.5 for ask-heavy book', () => {
      const features = extractor.extract(ASK_HEAVY_BOOK, 1000);
      expect(features.depthRatio1).toBeLessThan(0.5);
      expect(features.depthRatio5).toBeLessThan(0.5);
      expect(features.depthRatioFull).toBeLessThan(0.5);
    });

    it('depth ratio level 1 matches single-level calculation', () => {
      const features = extractor.extract(BID_HEAVY_BOOK, 1000);
      const bidVol1 = 50;
      const askVol1 = 5;
      const expected = bidVol1 / (bidVol1 + askVol1);
      expect(features.depthRatio1).toBeCloseTo(expected, 4);
    });
  });

  describe('Rise Ratio', () => {
    it('returns 0.5 for symmetric book', () => {
      const features = extractor.extract(SYMMETRIC_BOOK, 1000);
      expect(features.riseRatio).toBeCloseTo(0.5, 2);
    });

    it('returns > 0.5 for bid-heavy (bullish) book', () => {
      const features = extractor.extract(BID_HEAVY_BOOK, 1000);
      expect(features.riseRatio).toBeGreaterThan(0.5);
      expect(features.riseRatioWeighted).toBeGreaterThan(0.5);
    });

    it('returns < 0.5 for ask-heavy (bearish) book', () => {
      const features = extractor.extract(ASK_HEAVY_BOOK, 1000);
      expect(features.riseRatio).toBeLessThan(0.5);
      expect(features.riseRatioWeighted).toBeLessThan(0.5);
    });
  });

  describe('EMA Cross', () => {
    it('initializes EMAs to first mid-price', () => {
      const features = extractor.extract(SYMMETRIC_BOOK, 1000);
      expect(features.ema4).toBeCloseTo(100.25, 1);
      expect(features.ema8).toBeCloseTo(100.25, 1);
      expect(features.ema12).toBeCloseTo(100.25, 1);
    });

    it('EMA cross signal is 0 after single data point', () => {
      const features = extractor.extract(SYMMETRIC_BOOK, 1000);
      expect(features.emaCrossSignal).toBe(0);
    });

    it('EMA4 reacts faster than EMA12 to price changes', () => {
      // Feed rising prices
      for (let i = 0; i < 20; i++) {
        const price = 100 + i * 0.5;
        const book = makeOrderBook(
          [[price, 10], [price - 0.5, 20]],
          [[price + 0.5, 10], [price + 1, 20]]
        );
        extractor.extract(book, 1000 + i * 1000);
      }

      const state = extractor.getEMAState();
      // EMA4 should be closer to current price than EMA12
      const currentPrice = 100 + 19 * 0.5;
      expect(Math.abs(state.ema4 - currentPrice)).toBeLessThan(Math.abs(state.ema12 - currentPrice));
    });

    it('bullish cross signal when EMAs aligned upward', () => {
      // Feed strongly rising prices to create EMA4 > EMA8 > EMA12
      for (let i = 0; i < 50; i++) {
        const price = 100 + i * 2;
        const book = makeOrderBook(
          [[price, 10], [price - 1, 20]],
          [[price + 1, 10], [price + 2, 20]]
        );
        extractor.extract(book, 1000 + i * 1000);
      }
      const finalBook = makeOrderBook(
        [[200, 10], [199, 20]],
        [[201, 10], [202, 20]]
      );
      const features = extractor.extract(finalBook, 100000);
      expect(features.emaCrossSignal).toBe(1);
    });
  });

  describe('OBI', () => {
    it('OBI is 0 for symmetric book', () => {
      const features = extractor.extract(SYMMETRIC_BOOK, 1000);
      expect(features.obi).toBeCloseTo(0, 2);
    });

    it('OBI is positive for bid-heavy book', () => {
      const features = extractor.extract(BID_HEAVY_BOOK, 1000);
      expect(features.obi).toBeGreaterThan(0);
    });

    it('OBI is negative for ask-heavy book', () => {
      const features = extractor.extract(ASK_HEAVY_BOOK, 1000);
      expect(features.obi).toBeLessThan(0);
    });
  });

  describe('Volume Profile', () => {
    it('bidVolume + askVolume > 0 for non-empty book', () => {
      const features = extractor.extract(SYMMETRIC_BOOK, 1000);
      expect(features.bidVolume).toBeGreaterThan(0);
      expect(features.askVolume).toBeGreaterThan(0);
    });

    it('volumeImbalance is 0 for symmetric book', () => {
      const features = extractor.extract(SYMMETRIC_BOOK, 1000);
      expect(features.volumeImbalance).toBeCloseTo(0, 2);
    });
  });

  describe('assignLabels()', () => {
    it('assigns label 1 when future price rises', () => {
      const features: LOBFeatures[] = [
        { ...extractor.extract(SYMMETRIC_BOOK, 0), midPrice: 100 },
        { ...extractor.extract(SYMMETRIC_BOOK, 15000), midPrice: 105 },
      ];
      const labeled = extractor.assignLabels(features);
      expect(labeled[0].label).toBe(1);
    });

    it('assigns label 0 when future price falls', () => {
      const features: LOBFeatures[] = [
        { ...extractor.extract(SYMMETRIC_BOOK, 0), midPrice: 100 },
        { ...extractor.extract(SYMMETRIC_BOOK, 15000), midPrice: 95 },
      ];
      const labeled = extractor.assignLabels(features);
      expect(labeled[0].label).toBe(0);
    });

    it('handles single-element array', () => {
      const features = [extractor.extract(SYMMETRIC_BOOK, 0)];
      const labeled = extractor.assignLabels(features);
      expect(labeled.length).toBe(1);
      expect(labeled[0].label).toBe(0);
    });
  });

  describe('toFeatureVector()', () => {
    it('returns consistent feature names and vector', () => {
      const features = extractor.extract(SYMMETRIC_BOOK, 1000);
      const vec = extractor.toFeatureVector(features);
      const names = LOBFeatureExtractor.featureNames();
      expect(vec.length).toBe(names.length);
    });
  });

  describe('state management', () => {
    it('reset clears all history', () => {
      extractor.extract(SYMMETRIC_BOOK, 1000);
      extractor.extract(SYMMETRIC_BOOK, 2000);
      expect(extractor.getSnapshotHistory().length).toBe(2);

      extractor.reset();
      expect(extractor.getSnapshotHistory().length).toBe(0);
      expect(extractor.getPriceHistory().length).toBe(0);
      expect(extractor.getEMAState().initialized).toBe(false);
    });

    it('accumulates snapshot history', () => {
      for (let i = 0; i < 5; i++) {
        extractor.extract(SYMMETRIC_BOOK, i * 1000);
      }
      expect(extractor.getSnapshotHistory().length).toBe(5);
    });
  });
});
