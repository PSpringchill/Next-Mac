import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { OrderBookContext } from '../app/api/Page';
import { MLEngineProvider } from '../app/api/MLContext';
import { RiskProvider } from '../app/api/RiskContext';
import { StrategyProvider } from '../app/api/StrategyContext';
import MDP2TrainingBridge from '../app/components/TradingEngine/MDP2TrainingBridge';

vi.useFakeTimers();

const orderBookData = {
  bids: [['100', '1'] as [string, string]],
  asks: [['101', '1'] as [string, string]]
};

describe('MDP2TrainingBridge', () => {
  it('renders without crashing when contexts are present', () => {
    render(
      <OrderBookContext.Provider value={{ orderBookData } as any}>
        <MLEngineProvider>
          <RiskProvider>
            <StrategyProvider>
              <MDP2TrainingBridge />
            </StrategyProvider>
          </RiskProvider>
        </MLEngineProvider>
      </OrderBookContext.Provider>
    );

    expect(true).toBe(true);
  });
});
