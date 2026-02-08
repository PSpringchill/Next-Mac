import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// ─── ecamTheme ───
import { ECAM, severityColor, severityOrder } from '../app/components/cockpit/ecamTheme';
import type { Severity, SmoothedTechData, FeatureWeight, VolumeBin } from '../app/components/cockpit/ecamTheme';

describe('ecamTheme', () => {
  it('exports all ECAM color constants', () => {
    expect(ECAM.RED).toBe('#ff2222');
    expect(ECAM.GREEN).toBe('#00ff88');
    expect(ECAM.CYAN).toBe('#00ddff');
    expect(ECAM.AMBER).toBe('#ffaa00');
    expect(ECAM.BG).toBeTruthy();
    expect(ECAM.PANEL).toBeTruthy();
    expect(ECAM.BORDER).toBeTruthy();
  });

  it('severityColor returns correct colors', () => {
    expect(severityColor('warning')).toBe(ECAM.RED);
    expect(severityColor('caution')).toBe(ECAM.AMBER);
    expect(severityColor('memo')).toBe(ECAM.GREEN);
  });

  it('severityOrder sorts warning < caution < memo', () => {
    expect(severityOrder('warning')).toBeLessThan(severityOrder('caution'));
    expect(severityOrder('caution')).toBeLessThan(severityOrder('memo'));
  });
});

// ─── Helper: build a minimal SmoothedTechData ───
function makeTechData(overrides: Partial<SmoothedTechData> = {}): SmoothedTechData {
  return {
    midPrice: 100, bestBid: 99.9, bestAsk: 100.1,
    spread: 0.2, spreadPct: 0.002,
    obi: 10, totalDepth: 500000, imbalance: 5, liquidity: 20,
    wallStrength: 0.6, vwap: 99.8,
    ema20: 100.1, ema50: 100.3, ema200: 100.5,
    rsi: 55, macd: 0.5,
    sellWallNotional: 50000, buyWallNotional: 60000, maxWallNotional: 60000,
    sellWalls: [{ price: 101, size: 10, notional: 50000, distancePct: 1 }],
    buyWalls: [{ price: 99, size: 12, notional: 60000, distancePct: -1 }],
    nearestSellWallPct: 1, nearestBuyWallPct: -1,
    signal: 'bullish', heikinAshi: true,
    ...overrides,
  };
}

// ─── SpeedTape ───
import SpeedTape from '../app/components/cockpit/SpeedTape';

describe('SpeedTape', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <SpeedTape smoothedTech={makeTechData()} wallRangePct={5} priceRoC={1.2} />
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('displays current price in the SVG', () => {
    const { container } = render(
      <SpeedTape smoothedTech={makeTechData({ midPrice: 42000.1234 })} wallRangePct={5} priceRoC={0} />
    );
    const texts = container.querySelectorAll('text');
    const priceText = Array.from(texts).find(t => t.textContent?.includes('42000.12'));
    expect(priceText).toBeTruthy();
  });
});

// ─── AttitudeIndicator ───
import AttitudeIndicator from '../app/components/cockpit/AttitudeIndicator';

describe('AttitudeIndicator', () => {
  it('renders without crashing', () => {
    const profile = {
      bins: [{ price: 100, bidVol: 5, askVol: 3 }] as VolumeBin[],
      totalBidVol: 5,
      totalAskVol: 3,
    };
    const { container } = render(<AttitudeIndicator volumeProfile={profile} volRoC={10} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});

// ─── FeatureRadar ───
import FeatureRadar from '../app/components/cockpit/FeatureRadar';

describe('FeatureRadar', () => {
  it('renders NO DATA when empty', () => {
    const { container } = render(<FeatureRadar featureWeights={[]} />);
    const texts = container.querySelectorAll('text');
    const noData = Array.from(texts).find(t => t.textContent === 'NO DATA');
    expect(noData).toBeTruthy();
  });

  it('renders data polygon with features', () => {
    const weights: FeatureWeight[] = [
      { label: 'A', value: 0.5 },
      { label: 'B', value: 0.8 },
      { label: 'C', value: 0.3 },
    ];
    const { container } = render(<FeatureRadar featureWeights={weights} />);
    const polygons = container.querySelectorAll('polygon');
    // concentric rings (3 vertices × 4 rings) + 1 data polygon
    expect(polygons.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── MarketStatePanel ───
import MarketStatePanel from '../app/components/cockpit/MarketStatePanel';

describe('MarketStatePanel', () => {
  it('renders OBI and wall strength', () => {
    const setRange = () => {};
    const { container } = render(
      <MarketStatePanel
        smoothedTech={makeTechData({ obi: 25.3 })}
        wallRangePct={5}
        setWallRangePct={setRange}
        wallRangeOptions={[2, 5, 10]}
      />
    );
    expect(container.textContent).toContain('OBI');
    expect(container.textContent).toContain('+25.3%');
    expect(container.textContent).toContain('WALLS');
  });

  it('calls setWallRangePct on option click', () => {
    let captured = 0;
    const setRange = (v: number) => { captured = v; };
    render(
      <MarketStatePanel
        smoothedTech={makeTechData()}
        wallRangePct={5}
        setWallRangePct={setRange}
        wallRangeOptions={[2, 5, 10]}
      />
    );
    // Click the "10%" option
    const btn = screen.getByText('10%');
    fireEvent.click(btn);
    expect(captured).toBe(10);
  });
});

// ─── EngineInstruments ───
import EngineInstruments from '../app/components/cockpit/EngineInstruments';

describe('EngineInstruments', () => {
  it('renders RSI and MACD values', () => {
    const { container } = render(
      <EngineInstruments smoothedTech={makeTechData({ rsi: 72.5, macd: 1.234 })} isBullish={true} trendScore={3} />
    );
    expect(container.textContent).toContain('72.5');
    expect(container.textContent).toContain('+1.234');
    expect(container.textContent).toContain('BULLISH');
  });

  it('shows BEARISH when isBullish=false', () => {
    const { container } = render(
      <EngineInstruments smoothedTech={makeTechData({ signal: 'bearish' })} isBullish={false} trendScore={-2} />
    );
    expect(container.textContent).toContain('BEARISH');
  });
});

// ─── EcamWarningDisplay ───
import EcamWarningDisplay from '../app/components/cockpit/EcamWarningDisplay';

describe('EcamWarningDisplay', () => {
  it('shows NORMAL when no messages', () => {
    const { container } = render(
      <EcamWarningDisplay
        ecamMessages={[]}
        procedures={{ title: 'TEST', items: [] }}
        checkedItems={{}}
        toggleCheck={() => {}}
        resetChecks={() => {}}
        regimeTransitions={[]}
      />
    );
    expect(container.textContent).toContain('NORMAL');
  });

  it('renders warning messages with correct severity indicator', () => {
    const msgs = [
      { severity: 'warning' as Severity, system: 'RISK', text: 'KILL SWITCH' },
      { severity: 'memo' as Severity, system: 'ML', text: 'HIGH CONF' },
    ];
    const { container } = render(
      <EcamWarningDisplay
        ecamMessages={msgs}
        procedures={{ title: 'TEST', items: [] }}
        checkedItems={{}}
        toggleCheck={() => {}}
        resetChecks={() => {}}
        regimeTransitions={[]}
      />
    );
    expect(container.textContent).toContain('KILL SWITCH');
    expect(container.textContent).toContain('HIGH CONF');
  });

  it('toggles checklist items on click', () => {
    let toggled = '';
    const toggle = (key: string) => { toggled = key; };
    render(
      <EcamWarningDisplay
        ecamMessages={[]}
        procedures={{
          title: 'VOLATILE',
          items: [{ key: 'v1', action: 'REDUCE position', status: 'todo' }],
        }}
        checkedItems={{}}
        toggleCheck={toggle}
        resetChecks={() => {}}
        regimeTransitions={[]}
      />
    );
    fireEvent.click(screen.getByText('REDUCE position'));
    expect(toggled).toBe('v1');
  });

  it('renders regime transitions', () => {
    const transitions: [string, string, number][] = [
      ['ranging', 'trending_up', 1],
      ['trending_up', 'volatile', 1],
    ];
    const { container } = render(
      <EcamWarningDisplay
        ecamMessages={[]}
        procedures={{ title: 'TEST', items: [] }}
        checkedItems={{}}
        toggleCheck={() => {}}
        resetChecks={() => {}}
        regimeTransitions={transitions}
      />
    );
    expect(container.textContent).toContain('ranging');
    expect(container.textContent).toContain('trending_up');
    expect(container.textContent).toContain('volatile');
  });
});
