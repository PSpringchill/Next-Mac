import { MarketData, TradingSignal, PortfolioState, MarketRegime } from '@tradingEngine/types';
import Backtester, { TradingEngineLike } from './Backtester';
import DuelingDQN from './DuelingDQN';
import UnifiedStateEncoder from './UnifiedStateEncoder';
import Level2FeatureExtractor from './Level2FeatureExtractor';

interface ABResult {
  baseline: Awaited<ReturnType<Backtester['runBacktest']>>;
  mdp: Awaited<ReturnType<Backtester['runBacktest']>>;
  delta: {
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
  };
}

const DEFAULT_REGIME: MarketRegime = {
  name: 'unknown',
  volatility: 0.01,
  momentum: 0,
  isTransition: false,
  transitionProbabilities: [0, 0, 0, 0, 0]
};

const DEFAULT_PORTFOLIO: PortfolioState = {
  position: 0,
  unrealizedPnl: 0,
  timeInTradeSec: 0,
  marginUtilization: 0,
  tradesToday: 0,
  dailyPnl: 0,
  maxDrawdownToday: 0,
  availableRiskBudget: 1,
  lastTradeTimestamp: null
};

class MDPTradingEngine implements TradingEngineLike {
  private dqn: DuelingDQN;
  private encoder: UnifiedStateEncoder;
  private featureExtractor: Level2FeatureExtractor;

  constructor() {
    this.dqn = new DuelingDQN({ stateSize: 78, actionSize: 15, regimeHeads: 5 });
    this.encoder = new UnifiedStateEncoder();
    this.featureExtractor = new Level2FeatureExtractor();
  }

  async processMarketData(
    orderBook: MarketData['orderBook'],
    _openInterest: MarketData['openInterest'],
    _fundingRate: MarketData['fundingRate']
  ): Promise<TradingSignal> {
    const microstructure = this.featureExtractor.extractMicrostructure(orderBook);
    const state = this.encoder.encode({
      microstructure,
      regime: DEFAULT_REGIME,
      portfolio: DEFAULT_PORTFOLIO
    });

    const qValues = this.dqn.predict(state, 0);
    const values = Array.from(qValues.dataSync());
    qValues.dispose();

    let action = 0;
    let maxValue = values[0] ?? 0;
    for (let i = 1; i < values.length; i += 1) {
      if (values[i] > maxValue) {
        maxValue = values[i];
        action = i;
      }
    }

    const direction = action <= 4 ? -1 : action <= 9 ? 0 : 1;
    const strength = action <= 4 ? (5 - action) / 5 : action >= 10 ? (action - 9) / 5 : 0.1;

    // Sigmoid normalization: maps any Q-value range to (0, 1)
    const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
    const confidence = sigmoid(maxValue * 2); // scale for sensitivity

    return {
      direction,
      strength,
      confidence,
      timestamp: Date.now(),
      metadata: { action, qValue: maxValue }
    };
  }
}

class BaselineGBFSEngine implements TradingEngineLike {
  private prevMid = 0;

  async processMarketData(
    orderBook: MarketData['orderBook'],
    _openInterest: MarketData['openInterest'],
    _fundingRate: MarketData['fundingRate']
  ): Promise<TradingSignal> {
    const bestBid = parseFloat(orderBook.bids[0]?.[0] ?? '0');
    const bestAsk = parseFloat(orderBook.asks[0]?.[0] ?? '0');
    const mid = (bestBid + bestAsk) / 2;

    // Order book imbalance across top 5 levels
    let bidVol = 0, askVol = 0;
    const depth = Math.min(5, orderBook.bids.length, orderBook.asks.length);
    for (let i = 0; i < depth; i++) {
      bidVol += parseFloat(orderBook.bids[i]?.[1] ?? '0');
      askVol += parseFloat(orderBook.asks[i]?.[1] ?? '0');
    }
    const totalVol = bidVol + askVol;
    const imbalance = totalVol > 0 ? (bidVol - askVol) / totalVol : 0; // -1 to +1

    // Momentum from price change
    const momentum = this.prevMid > 0 ? (mid - this.prevMid) / this.prevMid : 0;
    this.prevMid = mid;

    // Combined signal: imbalance + momentum
    const rawSignal = imbalance * 0.7 + Math.sign(momentum) * Math.min(1, Math.abs(momentum) * 1000) * 0.3;
    const direction = rawSignal > 0.05 ? 1 : rawSignal < -0.05 ? -1 : 0;
    const strength = Math.min(1, Math.abs(rawSignal));
    const confidence = Math.min(1, Math.abs(imbalance) + strength * 0.5);

    return {
      direction,
      strength,
      confidence,
      timestamp: Date.now(),
      metadata: { mid, imbalance, momentum }
    };
  }
}

class ABEvaluator {
  async run(data: MarketData[]): Promise<ABResult> {
    const baselineEngine = new BaselineGBFSEngine();
    const mdpEngine = new MDPTradingEngine();

    const baselineTester = new Backtester(baselineEngine);
    const mdpTester = new Backtester(mdpEngine);

    const baseline = await baselineTester.runBacktest(data);
    const mdp = await mdpTester.runBacktest(data);

    return {
      baseline,
      mdp,
      delta: {
        totalReturn: mdp.totalReturn - baseline.totalReturn,
        sharpeRatio: mdp.sharpeRatio - baseline.sharpeRatio,
        maxDrawdown: mdp.maxDrawdown - baseline.maxDrawdown,
        winRate: mdp.winRate - baseline.winRate
      }
    };
  }
}

export default ABEvaluator;
export type { ABResult };
