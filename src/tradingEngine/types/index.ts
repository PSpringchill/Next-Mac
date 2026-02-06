// Core type definitions
export interface OrderBookData {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

export interface OpenInterestData {
  openInterest: string;
  symbol: string;
  time: number;
}

export interface MarketData {
  timestamp: number;
  price: number;
  orderBook: OrderBookData;
  openInterest: OpenInterestData;
  fundingRate: number;
}

export interface OrderLevel {
  price: number;
  volume: number;
  count?: number;
}

export interface MarketFeatures {
  obi: number;
  oic: number;
  frd: number;
  vwapDev: number;
  trendFilter: number;
  volumeProfile?: Float32Array;
  microstructure?: OrderBookMicrostructure;
}

export interface OrderBookMicrostructure {
  bidAskSpread: number;
  orderImbalance: number[];
  volumeProfile: Float32Array;
  orderFlowToxicity: number;
  liquidityDepth: number[];
  priceImpact: number;
}

export interface TradingSignal {
  direction: number;
  strength: number;
  confidence: number;
  timestamp: number;
  metadata?: any;
}

export interface MarketRegime {
  name: string;
  volatility: number;
  momentum: number;
  isTransition?: boolean;
  transitionProbabilities?: number[];
}

export interface PortfolioState {
  position: number;
  unrealizedPnl: number;
  timeInTradeSec: number;
  marginUtilization: number;
  tradesToday: number;
  dailyPnl: number;
  maxDrawdownToday: number;
  availableRiskBudget: number;
  volatility?: number;
  lastTradeTimestamp?: number | null;
}

export interface MarketStatePrediction {
  mostLikelyState: string;
  probability: number;
  expectedPriceMove: number;
  stateDistribution: Record<string, number>;
  confidence: number;
}

export interface MultiHorizonPrediction {
  horizon1ms: PredictionResult;
  horizon10ms: PredictionResult;
  horizon100ms: PredictionResult;
  featureImportance?: Map<string, number>;
  featureCorrelation?: Map<string, number>;
}

export interface PredictionResult {
  direction: 'buy' | 'sell' | 'hold';
  confidence: number;
  expectedReturn?: number;
}

export interface Experience {
  state: number[];
  action: number;
  reward: number;
  nextState: number[];
  done: boolean;
}

export interface BacktestResult {
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  trades: Trade[];
}

export interface Trade {
  type: 'BUY' | 'SELL';
  price: number;
  size: number;
  timestamp: number;
  pnl?: number;
}
