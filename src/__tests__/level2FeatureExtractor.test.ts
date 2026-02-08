import { describe, it, expect, beforeEach } from 'vitest';
import Level2FeatureExtractor from '../app/components/TradingEngine/Level2FeatureExtractor';
import { OrderBookData } from '@tradingEngine/types';

function makeBook(
  bids: Array<[number, number]>,
  asks: Array<[number, number]>
): OrderBookData {
  return {
    lastUpdateId: 1,
    bids: bids.map(([p, v]) => [p.toString(), v.toString()] as [string, string]),
    asks: asks.map(([p, v]) => [p.toString(), v.toString()] as [string, string]),
  };
}

const BOOK_10 = makeBook(
  Array.from({ length: 10 }, (_, i) => [100 - i * 0.5, 10 + i * 2] as [number, number]),
  Array.from({ length: 10 }, (_, i) => [100.5 + i * 0.5, 10 + i * 2] as [number, number])
);

describe('Level2FeatureExtractor', () => {
  let extractor: Level2FeatureExtractor;

  beforeEach(() => {
    extractor = new Level2FeatureExtractor();
  });

  describe('extractMicrostructure()', () => {
    it('computes correct bid-ask spread', () => {
      const micro = extractor.extractMicrostructure(BOOK_10);
      expect(micro.bidAskSpread).toBeCloseTo(0.5, 2);
    });

    it('returns multi-level imbalance array of length 10', () => {
      const micro = extractor.extractMicrostructure(BOOK_10);
      expect(micro.orderImbalance.length).toBe(10);
    });

    it('imbalance is 0 for symmetric book', () => {
      const symmetric = makeBook(
        [[100, 10], [99.5, 20]],
        [[100.5, 10], [101, 20]]
      );
      const micro = extractor.extractMicrostructure(symmetric);
      expect(micro.orderImbalance[0]).toBeCloseTo(0, 4);
    });

    it('volume profile has 20 entries', () => {
      const micro = extractor.extractMicrostructure(BOOK_10);
      expect(micro.volumeProfile.length).toBe(20);
    });

    it('volume profile is normalized to [0,1]', () => {
      const micro = extractor.extractMicrostructure(BOOK_10);
      for (let i = 0; i < micro.volumeProfile.length; i++) {
        expect(micro.volumeProfile[i]).toBeGreaterThanOrEqual(0);
        expect(micro.volumeProfile[i]).toBeLessThanOrEqual(1);
      }
    });

    it('liquidity depth has 20 entries (10 levels x 2 sides)', () => {
      const micro = extractor.extractMicrostructure(BOOK_10);
      expect(micro.liquidityDepth.length).toBe(20);
    });

    it('liquidity depth is monotonically increasing per side', () => {
      const micro = extractor.extractMicrostructure(BOOK_10);
      // Bid depths are at even indices, ask depths at odd
      for (let i = 2; i < 20; i += 2) {
        expect(micro.liquidityDepth[i]).toBeGreaterThanOrEqual(micro.liquidityDepth[i - 2]);
      }
    });

    it('price impact (Kyle lambda) is non-negative', () => {
      const micro = extractor.extractMicrostructure(BOOK_10);
      expect(micro.priceImpact).toBeGreaterThanOrEqual(0);
    });

    it('order flow toxicity is between 0 and 1', () => {
      const micro = extractor.extractMicrostructure(BOOK_10);
      expect(micro.orderFlowToxicity).toBeGreaterThanOrEqual(0);
      expect(micro.orderFlowToxicity).toBeLessThanOrEqual(1.5); // can exceed 1 due to concentration
    });

    it('handles empty order book', () => {
      const empty: OrderBookData = { lastUpdateId: 0, bids: [], asks: [] };
      const micro = extractor.extractMicrostructure(empty);
      expect(micro.bidAskSpread).toBe(0);
      expect(micro.priceImpact).toBe(0);
    });

    it('handles single-level book', () => {
      const single = makeBook([[100, 10]], [[101, 10]]);
      const micro = extractor.extractMicrostructure(single);
      expect(micro.bidAskSpread).toBeCloseTo(1, 2);
    });
  });
});
