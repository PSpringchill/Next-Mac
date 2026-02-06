import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RiskProvider, useRiskManager } from '../app/api/RiskContext';

const TestConsumer = () => {
  const { config, portfolioState } = useRiskManager();
  return (
    <div>
      <span data-testid="max-position">{config.maxPositionSize}</span>
      <span data-testid="portfolio-position">{portfolioState.position}</span>
    </div>
  );
};

describe('RiskContext', () => {
  it('provides config and portfolio state', () => {
    render(
      <RiskProvider>
        <TestConsumer />
      </RiskProvider>
    );

    expect(screen.getByTestId('max-position').textContent).toBeTruthy();
    expect(screen.getByTestId('portfolio-position').textContent).toBe('0');
  });
});
