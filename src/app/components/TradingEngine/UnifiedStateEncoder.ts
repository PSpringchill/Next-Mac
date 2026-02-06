import {
  MarketRegime,
  MarketStatePrediction,
  MultiHorizonPrediction,
  OrderBookMicrostructure,
  PortfolioState,
  TradingSignal
} from '@tradingEngine/types';

export interface UnifiedSignalInput {
  multiHorizon?: MultiHorizonPrediction | null;
  markov?: MarketStatePrediction | null;
  a3cSignal?: TradingSignal | null;
  ddpgSignal?: TradingSignal | null;
}

export interface UnifiedTemporalInput {
  secondsSinceLastTrade?: number;
  volatilityRatio?: number;
  spreadZScore?: number;
  hourOfDay?: number;
}

export interface UnifiedStateInput {
  microstructure: OrderBookMicrostructure;
  regime: MarketRegime;
  portfolio: PortfolioState;
  signals?: UnifiedSignalInput;
  temporal?: UnifiedTemporalInput;
}

const REGIME_NAMES = ['trending_up', 'trending_down', 'ranging', 'volatile', 'breakout'];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const padArray = (values: number[], length: number, fill = 0) => {
  if (values.length >= length) return values.slice(0, length);
  return [...values, ...new Array(length - values.length).fill(fill)];
};

class UnifiedStateEncoder {
  encode(input: UnifiedStateInput): number[] {
    const microstructure = this.encodeMicrostructure(input.microstructure);
    const regime = this.encodeRegime(input.regime);
    const portfolio = this.encodePortfolio(input.portfolio);
    const signals = this.encodeSignals(input.signals);
    const temporal = this.encodeTemporal(input.temporal, input.portfolio);

    return [...microstructure, ...regime, ...portfolio, ...signals, ...temporal];
  }

  private encodeMicrostructure(microstructure: OrderBookMicrostructure): number[] {
    const base = [
      microstructure.bidAskSpread,
      microstructure.orderFlowToxicity,
      microstructure.priceImpact
    ];

    const imbalance = padArray(microstructure.orderImbalance || [], 10, 0);
    const volumeProfile = padArray(Array.from(microstructure.volumeProfile || []), 20, 0);
    const liquidityDepth = padArray(microstructure.liquidityDepth || [], 17, 0);

    return [...base, ...imbalance, ...volumeProfile, ...liquidityDepth];
  }

  private encodeRegime(regime: MarketRegime): number[] {
    const regimeIndex = Math.max(0, REGIME_NAMES.findIndex(name => regime.name?.includes(name)));
    const regimeIdNorm = REGIME_NAMES.length > 1 ? regimeIndex / (REGIME_NAMES.length - 1) : 0;
    const transitions = padArray(regime.transitionProbabilities || [], 5, 0);

    return [
      regimeIdNorm,
      ...transitions,
      regime.momentum,
      regime.volatility
    ];
  }

  private encodePortfolio(portfolio: PortfolioState): number[] {
    return [
      portfolio.position,
      portfolio.unrealizedPnl,
      portfolio.timeInTradeSec,
      portfolio.marginUtilization,
      portfolio.tradesToday,
      portfolio.dailyPnl,
      portfolio.maxDrawdownToday,
      portfolio.availableRiskBudget
    ];
  }

  private encodeSignals(signals?: UnifiedSignalInput): number[] {
    const horizonValues = this.getHorizonSignals(signals?.multiHorizon);
    const markovExpected = signals?.markov?.expectedPriceMove ?? 0;
    const markovConfidence = signals?.markov?.confidence ?? 0;
    const a3cValue = this.encodeSignal(signals?.a3cSignal);
    const ddpgValue = this.encodeSignal(signals?.ddpgSignal);
    const ensembleAgreement = this.computeAgreement(a3cValue, ddpgValue);

    return [
      ...horizonValues,
      markovExpected,
      markovConfidence,
      a3cValue,
      ddpgValue,
      ensembleAgreement
    ];
  }

  private encodeTemporal(temporal: UnifiedTemporalInput | undefined, portfolio: PortfolioState): number[] {
    const secondsSinceLastTrade = temporal?.secondsSinceLastTrade
      ?? (portfolio.lastTradeTimestamp ? (Date.now() - portfolio.lastTradeTimestamp) / 1000 : 0);
    const hourOfDay = temporal?.hourOfDay ?? new Date().getHours();

    return [
      secondsSinceLastTrade,
      temporal?.volatilityRatio ?? 0,
      temporal?.spreadZScore ?? 0,
      clamp(hourOfDay / 23, 0, 1)
    ];
  }

  private getHorizonSignals(prediction?: MultiHorizonPrediction | null): number[] {
    if (!prediction) return [0, 0, 0];

    const horizon1 = this.directionValue(prediction.horizon1ms);
    const horizon10 = this.directionValue(prediction.horizon10ms);
    const horizon100 = this.directionValue(prediction.horizon100ms);

    return [horizon1, horizon10, horizon100];
  }

  private directionValue(result?: { direction: string; confidence?: number }): number {
    if (!result) return 0;
    const confidence = result.confidence ?? 0;
    const direction = result.direction === 'buy' ? 1 : result.direction === 'sell' ? -1 : 0;
    return confidence * direction;
  }

  private encodeSignal(signal?: TradingSignal | null): number {
    if (!signal) return 0;
    return signal.direction * (signal.confidence || 0);
  }

  private computeAgreement(a3cValue: number, ddpgValue: number): number {
    if (a3cValue === 0 || ddpgValue === 0) return 0;
    return Math.sign(a3cValue) === Math.sign(ddpgValue) ? 1 : -1;
  }
}

export default UnifiedStateEncoder;
