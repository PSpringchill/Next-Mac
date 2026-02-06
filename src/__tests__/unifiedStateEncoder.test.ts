import { describe, it, expect } from 'vitest';
import UnifiedStateEncoder from '../app/components/TradingEngine/UnifiedStateEncoder';

const encoder = new UnifiedStateEncoder();

describe('UnifiedStateEncoder', () => {
  it('encodes a 78-dimension state vector', () => {
    const vector = encoder.encode({
      microstructure: {
        bidAskSpread: 0.1,
        orderFlowToxicity: 0.2,
        priceImpact: 0.05,
        orderImbalance: Array.from({ length: 10 }, (_, i) => i / 10),
        volumeProfile: Float32Array.from({ length: 20 }, (_, i) => i / 20),
        liquidityDepth: Array.from({ length: 17 }, () => 1)
      },
      regime: {
        name: 'trending_up',
        volatility: 0.3,
        momentum: 0.5,
        transitionProbabilities: [0.2, 0.3, 0.1, 0.2, 0.2]
      },
      portfolio: {
        position: 0.5,
        unrealizedPnl: 0.1,
        timeInTradeSec: 120,
        marginUtilization: 0.2,
        tradesToday: 3,
        dailyPnl: 0.05,
        maxDrawdownToday: 0.02,
        availableRiskBudget: 0.8,
        volatility: 0.3,
        lastTradeTimestamp: Date.now() - 1000
      }
    });

    expect(vector.length).toBe(78);
  });
});
