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

    return {
      direction,
      strength,
      confidence: Math.min(1, Math.abs(maxValue) || 0.1),
      timestamp: Date.now(),
      metadata: { action, qValue: maxValue }
    };
  }
}

class BaselineGBFSEngine implements TradingEngineLike {
  async processMarketData(
    orderBook: MarketData['orderBook'],
    openInterest: MarketData['openInterest'],
    fundingRate: MarketData['fundingRate']
  ): Promise<TradingSignal> {
    const bestBid = parseFloat(orderBook.bids[0]?.[0] ?? '0');
    const bestAsk = parseFloat(orderBook.asks[0]?.[0] ?? '0');
    const mid = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;
    const oi = parseFloat(openInterest.openInterest || '0');
    const bias = (fundingRate || 0) + (oi % 1000) * 1e-6;

    const direction = bias > 0.0005 ? 1 : bias < -0.0005 ? -1 : 0;
    const strength = Math.min(1, Math.abs(bias) * 1000 + spread * 10);

    return {
      direction,
      strength,
      confidence: strength,
      timestamp: Date.now(),
      metadata: { mid, spread, bias }
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
