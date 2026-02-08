// src/tradingEngine/MarketStateConfig.ts
// Machine-readable Market State configuration derived from MarketStates.md
// Maps each market phase to: detection rules, trade settings, and risk parameters

import { MarketRegime } from '@tradingEngine/types';

// ─── Enums ───────────────────────────────────────────────────────────────────

export enum MarketPhase {
  UPTREND = 'uptrend',
  DOWNTREND = 'downtrend',
  RANGE_BOUND = 'range_bound',
  BREAKOUT = 'breakout',
  REVERSAL = 'reversal',
  PULLBACK = 'pullback',
  HIGH_VOLATILITY = 'high_volatility',
  LOW_VOLATILITY = 'low_volatility',
}

export enum SubPhase {
  NONE = 'none',
  OVERBOUGHT = 'overbought',
  OVERSOLD = 'oversold',
  ACCUMULATION = 'accumulation',
  DISTRIBUTION = 'distribution',
}

export enum TradeMode {
  TREND_FOLLOW = 'trend_follow',     // Directional: buy dips / sell rallies
  GRID_NEUTRAL = 'grid_neutral',     // Both sides, profit per grid
  BREAKOUT_ENTRY = 'breakout_entry', // Wait for confirmation, enter with momentum
  REVERSAL_ENTRY = 'reversal_entry', // Counter-trend entry at extremes
  MEAN_REVERSION = 'mean_reversion', // Fade moves back to mean
  HOLD = 'hold',                     // No new entries, hold existing positions
}

// ─── Indicator Thresholds ────────────────────────────────────────────────────

export interface IndicatorThresholds {
  // MA Conditions
  priceAboveMA50?: boolean;
  priceAboveMA200?: boolean;
  goldenCross?: boolean;  // MA50 > MA200
  deathCross?: boolean;   // MA50 < MA200

  // MACD
  macdAboveSignal?: boolean;
  macdHistogramIncreasing?: boolean;
  macdHistogramNearZero?: boolean; // |histogram| < threshold
  macdDivergence?: 'bullish' | 'bearish' | null;

  // RSI
  rsiRange?: [number, number]; // [min, max] — e.g., [55, 70] for uptrend

  // ATR (volatility identification, confirmed by Std Dev)
  atrRising?: boolean;
  atrLevel?: 'low' | 'normal' | 'high';  // Relative to rolling percentile
  atrConfirmedByStdDev?: boolean;        // ATR trend must be confirmed by StdDev direction

  // Fisher Transform
  fisherCrossover?: 'positive' | 'negative' | null;
  fisherExtreme?: 'high' | 'low' | null;

  // Bollinger Bands
  bollingerSqueezing?: boolean;

  // Standard Deviation
  stdDevExpanding?: boolean;

  // Volume
  volumeIncreasing?: boolean;
}

// ─── Trade Settings ──────────────────────────────────────────────────────────

export interface TradeSettings {
  mode: TradeMode;
  direction: 'long' | 'short' | 'both';

  // TP/SL Configuration
  takeProfitType: 'atr_multiplier' | 'fixed_pct' | 'sr_level' | 'grid_pct';
  takeProfitValue: number;        // e.g., ATR multiplier = 2, fixed = 0.02, grid = 0.007
  stopLossType: 'fixed_pct' | 'atr_multiplier' | 'sr_level';
  stopLossValue: number;

  // Grid trade settings (for GRID_NEUTRAL mode)
  gridConfig?: {
    gridCount: number;            // Number of grid levels
    gridSpacingPct: number;       // Spacing between grids as %
    profitPerGridPct: number;     // Target profit per grid (0.6-0.8%)
    maxExposurePct: number;       // Max total exposure as % of capital
  };

  // Position sizing
  positionSizePct: number;        // % of capital per trade
  maxConcurrentTrades: number;

  // Risk multiplier (applied to base risk parameters)
  riskMultiplier: number;
}

// ─── Market State Definition ─────────────────────────────────────────────────

export interface MarketStateDefinition {
  phase: MarketPhase;
  description: string;
  indicators: IndicatorThresholds;
  tradeSettings: TradeSettings;

  // Priority for conflict resolution (higher = takes precedence)
  priority: number;

  // Minimum confidence score required to activate this state
  minConfidence: number;

  // Regime mapping (maps to existing MarketRegime interface)
  regimeMapping: {
    name: string;
    volatility: number;
    momentum: number;
  };
}

// ─── State Definitions ───────────────────────────────────────────────────────

export const MARKET_STATE_CONFIG: MarketStateDefinition[] = [
  // ━━━ 1. UPTREND ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    phase: MarketPhase.UPTREND,
    description: 'Bullish trend with higher highs and higher lows',
    indicators: {
      priceAboveMA50: true,
      priceAboveMA200: true,
      goldenCross: true,
      macdAboveSignal: true,
      macdHistogramIncreasing: true,
      rsiRange: [55, 80],
      atrRising: true,
      atrConfirmedByStdDev: true,       // ATR confirmed by StdDev expansion
      fisherCrossover: 'positive',
      stdDevExpanding: true,
    },
    tradeSettings: {
      mode: TradeMode.TREND_FOLLOW,
      direction: 'long',
      takeProfitType: 'atr_multiplier',
      takeProfitValue: 2,              // TP + (ATR × 2), confirmed by StdDev
      stopLossType: 'atr_multiplier',
      stopLossValue: 1.5,              // 1.5 × ATR below entry
      positionSizePct: 3,
      maxConcurrentTrades: 3,
      riskMultiplier: 1.0,
    },
    priority: 8,
    minConfidence: 0.6,
    regimeMapping: { name: 'trending_up', volatility: 0.02, momentum: 1 },
  },

  // ━━━ 2. DOWNTREND ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    phase: MarketPhase.DOWNTREND,
    description: 'Bearish trend with lower highs and lower lows',
    indicators: {
      priceAboveMA50: false,
      priceAboveMA200: false,
      deathCross: true,
      macdAboveSignal: false,
      macdHistogramIncreasing: false,
      rsiRange: [20, 45],
      atrRising: true,
      atrConfirmedByStdDev: true,       // ATR confirmed by StdDev expansion
      fisherCrossover: 'negative',
      stdDevExpanding: true,
    },
    tradeSettings: {
      mode: TradeMode.TREND_FOLLOW,
      direction: 'short',
      takeProfitType: 'atr_multiplier',
      takeProfitValue: 2,              // TP + (ATR × 2), confirmed by StdDev
      stopLossType: 'atr_multiplier',
      stopLossValue: 1.5,
      positionSizePct: 3,
      maxConcurrentTrades: 3,
      riskMultiplier: 1.0,
    },
    priority: 8,
    minConfidence: 0.6,
    regimeMapping: { name: 'trending_down', volatility: 0.02, momentum: -1 },
  },

  // ━━━ 3. RANGE-BOUND ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    phase: MarketPhase.RANGE_BOUND,
    description: 'Sideways/choppy market between support and resistance',
    indicators: {
      macdHistogramNearZero: true,
      rsiRange: [40, 60],
      fisherCrossover: null,
      stdDevExpanding: false,
    },
    tradeSettings: {
      mode: TradeMode.GRID_NEUTRAL,
      direction: 'both',
      takeProfitType: 'grid_pct',
      takeProfitValue: 0.007,          // Tight TP
      stopLossType: 'fixed_pct',
      stopLossValue: 0.015,
      positionSizePct: 1.5,
      maxConcurrentTrades: 6,
      riskMultiplier: 0.8,
      gridConfig: {
        gridCount: 10,
        gridSpacingPct: 0.3,
        profitPerGridPct: 0.7,         // 0.6-0.8% target
        maxExposurePct: 15,
      },
    },
    priority: 4,
    minConfidence: 0.5,
    regimeMapping: { name: 'ranging', volatility: 0.01, momentum: 0 },
  },

  // ━━━ 4. BREAKOUT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    phase: MarketPhase.BREAKOUT,
    description: 'Price breaking out of consolidation range',
    indicators: {
      atrRising: true,
      atrLevel: 'high',
      stdDevExpanding: true,
      macdHistogramIncreasing: true,
      rsiRange: [60, 90],             // Above 60 for bullish breakout
    },
    tradeSettings: {
      mode: TradeMode.BREAKOUT_ENTRY,
      direction: 'both',              // Direction determined by breakout side
      takeProfitType: 'sr_level',     // TP at next major S/R
      takeProfitValue: 0,             // Determined dynamically
      stopLossType: 'sr_level',       // SL on opposite side of broken S/R
      stopLossValue: 0,               // Determined dynamically
      positionSizePct: 2.5,
      maxConcurrentTrades: 2,
      riskMultiplier: 1.2,
    },
    priority: 9,                      // High priority — overrides range-bound
    minConfidence: 0.7,
    regimeMapping: { name: 'breakout', volatility: 0.03, momentum: 0.5 },
  },

  // ━━━ 5. REVERSAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    phase: MarketPhase.REVERSAL,
    description: 'Trend direction change with divergence signals',
    indicators: {
      macdDivergence: 'bullish',      // Or 'bearish' — detected dynamically
      rsiRange: [25, 35],             // Moving out of extreme (oversold → reversal up)
      fisherExtreme: 'low',           // Divergence from price
      atrRising: true,
      stdDevExpanding: true,
    },
    tradeSettings: {
      mode: TradeMode.REVERSAL_ENTRY,
      direction: 'both',
      takeProfitType: 'sr_level',     // TP at next major S/R
      takeProfitValue: 0,
      stopLossType: 'sr_level',       // SL on opposite side
      stopLossValue: 0,
      positionSizePct: 2,
      maxConcurrentTrades: 2,
      riskMultiplier: 0.7,            // Reduced size — counter-trend is risky
    },
    priority: 7,
    minConfidence: 0.75,              // Needs high confidence
    regimeMapping: { name: 'reversal', volatility: 0.03, momentum: -0.5 },
  },

  // ━━━ 6. PULLBACK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    phase: MarketPhase.PULLBACK,
    description: 'Temporary retracement within ongoing trend',
    indicators: {
      priceAboveMA200: true,          // Still in overall trend
      rsiRange: [45, 55],             // Pulling back from overbought
      macdHistogramIncreasing: false,  // Decreasing but above zero
      macdAboveSignal: true,          // Still bullish structure
      atrRising: false,               // ATR decreasing slightly
    },
    tradeSettings: {
      mode: TradeMode.TREND_FOLLOW,
      direction: 'long',              // Buy the dip in uptrend context
      takeProfitType: 'atr_multiplier',
      takeProfitValue: 1.5,           // TP + (ATR × 1.5), tighter than full trend
      stopLossType: 'atr_multiplier',
      stopLossValue: 2,               // Wider SL to allow retest room
      positionSizePct: 2,
      maxConcurrentTrades: 2,
      riskMultiplier: 0.8,
    },
    priority: 6,
    minConfidence: 0.6,
    regimeMapping: { name: 'pullback', volatility: 0.015, momentum: 0.3 },
  },

  // ━━━ 7. HIGH VOLATILITY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    phase: MarketPhase.HIGH_VOLATILITY,
    description: 'Large price swings, news-driven or liquidation cascades',
    indicators: {
      atrRising: true,
      atrLevel: 'high',
      stdDevExpanding: true,
      rsiRange: [20, 80],             // Can be anywhere — wide range
    },
    tradeSettings: {
      mode: TradeMode.GRID_NEUTRAL,
      direction: 'both',
      takeProfitType: 'grid_pct',
      takeProfitValue: 0.008,
      stopLossType: 'atr_multiplier',
      stopLossValue: 2,               // Wider SL for volatility
      positionSizePct: 1,             // Reduced position size
      maxConcurrentTrades: 6,
      riskMultiplier: 0.5,            // Half risk in high vol
      gridConfig: {
        gridCount: 8,
        gridSpacingPct: 0.5,          // Wider grids for vol
        profitPerGridPct: 0.7,
        maxExposurePct: 10,
      },
    },
    priority: 10,                     // Highest priority — safety first
    minConfidence: 0.5,
    regimeMapping: { name: 'volatile', volatility: 0.05, momentum: 0 },
  },

  // ━━━ 8. LOW VOLATILITY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    phase: MarketPhase.LOW_VOLATILITY,
    description: 'Tight price movement, low volume, contraction phase',
    indicators: {
      atrLevel: 'low',
      atrRising: false,
      stdDevExpanding: false,
      bollingerSqueezing: true,
      macdHistogramNearZero: true,
    },
    tradeSettings: {
      mode: TradeMode.HOLD,
      direction: 'both',
      takeProfitType: 'fixed_pct',
      takeProfitValue: 0.005,         // Tight TP
      stopLossType: 'fixed_pct',
      stopLossValue: 0.003,           // Tight SL
      positionSizePct: 1,
      maxConcurrentTrades: 1,
      riskMultiplier: 0.3,            // Minimal risk — waiting for breakout
    },
    priority: 5,                      // Above trends when vol is clearly compressed
    minConfidence: 0.4,
    regimeMapping: { name: 'low_volatility', volatility: 0.005, momentum: 0 },
  },
];

// ─── State Detector ──────────────────────────────────────────────────────────

export interface IndicatorValues {
  price: number;
  ma50: number;
  ma200: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  prevMacdHistogram: number;
  rsi: number;
  atr: number;
  atrPercentile: number;    // 0-1, current ATR vs rolling 100-period
  fisherTransform: number;
  prevFisherTransform: number;
  stdDev: number;
  prevStdDev: number;
  bollingerWidth: number;
  prevBollingerWidth: number;
  volume: number;
  prevVolume: number;
}

export interface DetectedState {
  phase: MarketPhase;
  subPhase: SubPhase;
  confidence: number;
  tradeSettings: TradeSettings;
  regime: MarketRegime;
  activeIndicators: string[];
}

class MarketStateDetector {
  private stateHistory: DetectedState[] = [];
  private readonly maxHistory = 100;

  detect(indicators: IndicatorValues): DetectedState {
    const scored = MARKET_STATE_CONFIG.map(config => ({
      config,
      score: this.scoreState(config, indicators),
    }));

    // Sort by score × priority, pick best
    scored.sort((a, b) => {
      const aWeight = a.score * a.config.priority;
      const bWeight = b.score * b.config.priority;
      return bWeight - aWeight;
    });

    const best = scored[0];
    const confidence = best.score;
    const activeIndicators = this.getActiveIndicators(best.config, indicators);

    // Detect sub-phase
    const subPhase = this.detectSubPhase(indicators);

    const detected: DetectedState = {
      phase: best.config.phase,
      subPhase,
      confidence,
      tradeSettings: this.adjustTradeSettings(best.config.tradeSettings, indicators, subPhase),
      regime: {
        ...best.config.regimeMapping,
        isTransition: this.isTransition(best.config.phase),
      },
      activeIndicators,
    };

    this.stateHistory.push(detected);
    if (this.stateHistory.length > this.maxHistory) this.stateHistory.shift();

    return detected;
  }

  private scoreState(config: MarketStateDefinition, ind: IndicatorValues): number {
    const checks: boolean[] = [];
    const t = config.indicators;

    if (t.priceAboveMA50 !== undefined) checks.push(t.priceAboveMA50 === (ind.price > ind.ma50));
    if (t.priceAboveMA200 !== undefined) checks.push(t.priceAboveMA200 === (ind.price > ind.ma200));
    if (t.goldenCross !== undefined) checks.push(t.goldenCross === (ind.ma50 > ind.ma200));
    if (t.deathCross !== undefined) checks.push(t.deathCross === (ind.ma50 < ind.ma200));
    if (t.macdAboveSignal !== undefined) checks.push(t.macdAboveSignal === (ind.macdLine > ind.macdSignal));
    if (t.macdHistogramIncreasing !== undefined) {
      checks.push(t.macdHistogramIncreasing === (ind.macdHistogram > ind.prevMacdHistogram));
    }
    if (t.macdHistogramNearZero !== undefined) {
      checks.push(t.macdHistogramNearZero === (Math.abs(ind.macdHistogram) < 0.001));
    }
    if (t.rsiRange) {
      checks.push(ind.rsi >= t.rsiRange[0] && ind.rsi <= t.rsiRange[1]);
    }
    if (t.atrRising !== undefined) checks.push(t.atrRising === (ind.atrPercentile > 0.6));
    if (t.atrConfirmedByStdDev !== undefined) {
      // ATR direction must be confirmed by StdDev moving in same direction
      const atrIsRising = ind.atrPercentile > 0.6;
      const stdDevIsExpanding = ind.stdDev > ind.prevStdDev;
      checks.push(t.atrConfirmedByStdDev === (atrIsRising && stdDevIsExpanding));
    }
    if (t.atrLevel !== undefined) {
      if (t.atrLevel === 'high') checks.push(ind.atrPercentile > 0.8);
      else if (t.atrLevel === 'low') checks.push(ind.atrPercentile < 0.2);
      else checks.push(ind.atrPercentile >= 0.2 && ind.atrPercentile <= 0.8);
    }
    if (t.fisherCrossover !== undefined) {
      if (t.fisherCrossover === 'positive') {
        checks.push(ind.fisherTransform > ind.prevFisherTransform && ind.fisherTransform > 0);
      } else if (t.fisherCrossover === 'negative') {
        checks.push(ind.fisherTransform < ind.prevFisherTransform && ind.fisherTransform < 0);
      }
    }
    if (t.stdDevExpanding !== undefined) checks.push(t.stdDevExpanding === (ind.stdDev > ind.prevStdDev));
    if (t.bollingerSqueezing !== undefined) {
      checks.push(t.bollingerSqueezing === (ind.bollingerWidth < ind.prevBollingerWidth));
    }
    if (t.volumeIncreasing !== undefined) checks.push(t.volumeIncreasing === (ind.volume > ind.prevVolume));

    if (checks.length === 0) return 0;
    return checks.filter(Boolean).length / checks.length;
  }

  private detectSubPhase(ind: IndicatorValues): SubPhase {
    if (ind.rsi > 70) return SubPhase.OVERBOUGHT;
    if (ind.rsi < 30) return SubPhase.OVERSOLD;
    // Accumulation: low vol + stable price + slight volume increase
    if (ind.atrPercentile < 0.2 && ind.rsi >= 40 && ind.rsi <= 50 && ind.volume > ind.prevVolume) {
      return SubPhase.ACCUMULATION;
    }
    // Distribution: weakening momentum near highs
    if (ind.rsi > 60 && ind.macdHistogram < ind.prevMacdHistogram && ind.volume > ind.prevVolume) {
      return SubPhase.DISTRIBUTION;
    }
    return SubPhase.NONE;
  }

  private adjustTradeSettings(
    base: TradeSettings,
    ind: IndicatorValues,
    subPhase: SubPhase
  ): TradeSettings {
    const adjusted = { ...base };

    // Reduce risk in overbought/oversold
    if (subPhase === SubPhase.OVERBOUGHT || subPhase === SubPhase.OVERSOLD) {
      adjusted.riskMultiplier *= 0.5;
      adjusted.maxConcurrentTrades = Math.max(1, Math.floor(adjusted.maxConcurrentTrades / 2));
    }

    // In distribution phase, tighten stops
    if (subPhase === SubPhase.DISTRIBUTION) {
      adjusted.riskMultiplier *= 0.6;
    }

    // Dynamic ATR-based TP: TP = base + (ATR × multiplier) as % of price
    // Confirmed by StdDev: if StdDev is expanding, use full ATR; if contracting, reduce by 30%
    if (adjusted.takeProfitType === 'atr_multiplier') {
      const stdDevConfirmed = ind.stdDev > ind.prevStdDev;
      const atrPct = ind.price > 0 ? (ind.atr / ind.price) : 0;
      const baseTP = atrPct * adjusted.takeProfitValue;
      adjusted.takeProfitValue = stdDevConfirmed ? baseTP : baseTP * 0.7;
    }

    return adjusted;
  }

  private isTransition(newPhase: MarketPhase): boolean {
    if (this.stateHistory.length === 0) return false;
    return this.stateHistory[this.stateHistory.length - 1].phase !== newPhase;
  }

  private getActiveIndicators(config: MarketStateDefinition, ind: IndicatorValues): string[] {
    const active: string[] = [];
    const t = config.indicators;

    if (t.priceAboveMA50 !== undefined && t.priceAboveMA50 === (ind.price > ind.ma50)) active.push('MA50');
    if (t.priceAboveMA200 !== undefined && t.priceAboveMA200 === (ind.price > ind.ma200)) active.push('MA200');
    if (t.macdAboveSignal !== undefined && t.macdAboveSignal === (ind.macdLine > ind.macdSignal)) active.push('MACD');
    if (t.rsiRange && ind.rsi >= t.rsiRange[0] && ind.rsi <= t.rsiRange[1]) active.push('RSI');
    if (t.atrRising !== undefined) active.push('ATR');
    if (t.atrConfirmedByStdDev !== undefined) active.push('ATR+StdDev');
    if (t.stdDevExpanding !== undefined) active.push('StdDev');
    if (t.fisherCrossover !== undefined) active.push('Fisher');
    if (t.bollingerSqueezing !== undefined) active.push('Bollinger');

    return active;
  }

  getStateHistory(): DetectedState[] {
    return [...this.stateHistory];
  }

  getCurrentPhase(): MarketPhase | null {
    if (this.stateHistory.length === 0) return null;
    return this.stateHistory[this.stateHistory.length - 1].phase;
  }
}

export default MarketStateDetector;
