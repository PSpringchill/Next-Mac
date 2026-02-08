import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { 
  TradingSignal, 
  MarketRegime, 
  MarketStatePrediction,
  BacktestResult,
  OrderBookData,
  OpenInterestData,
  MarketData,
  Trade
} from '@tradingEngine/types';
import type { ParetoState } from '../app/components/TradingEngine/ParetoAnalyzer';
import type { RegimeResult } from '../app/components/TradingEngine/DynamicThresholds';
import type { SignalFilterState } from '../app/components/TradingEngine/PaperTradingEngine';

interface TradingState {
  // Current market data
  currentPrice: number;
  orderBook: OrderBookData | null;
  openInterest: OpenInterestData | null;
  
  // Predictions
  currentSignal: TradingSignal | null;
  marketRegime: MarketRegime | null;
  markovPrediction: MarketStatePrediction | null;
  
  // Performance
  backtestResults: BacktestResult | null;
  livePerformance: {
    pnl: number;
    winRate: number;
    totalTrades: number;
  };

  executionMode: 'paper' | 'live';
  isExecutionEnabled: boolean;

  recordingEnabled: boolean;
  recordedData: MarketData[];

  evaluationResults: {
    baseline: BacktestResult;
    mdp: BacktestResult;
    delta: {
      totalReturn: number;
      sharpeRatio: number;
      maxDrawdown: number;
      winRate: number;
    };
  } | null;
  stressResults: Array<{ scenario: string; trades: Trade[]; maxDrawdown: number; finalPnl: number }> | null;

  // Pareto & Dynamic Regime
  paretoState: ParetoState | null;
  dynamicRegime: RegimeResult | null;
  paretoHistory: Array<{ alpha: number; tailRisk: number; timestamp: number }>;

  // MCML: Signal Filter (Gradient Surprise + HMM)
  signalFilter: SignalFilterState | null;
  // Actions
  updateOrderBook: (orderBook: OrderBookData) => void;
  updateSignal: (signal: TradingSignal) => void;
  updateRegime: (regime: MarketRegime) => void;
  updateMarkovPrediction: (prediction: MarketStatePrediction) => void;
  updateBacktestResults: (results: BacktestResult) => void;
  updateLivePerformance: (update: Partial<TradingState['livePerformance']>) => void;
  setExecutionMode: (mode: TradingState['executionMode']) => void;
  setExecutionEnabled: (enabled: boolean) => void;
  startRecording: () => void;
  stopRecording: () => void;
  clearRecordedData: () => void;
  appendRecordedData: (data: MarketData) => void;
  setEvaluationResults: (results: TradingState['evaluationResults']) => void;
  setStressResults: (results: TradingState['stressResults']) => void;
  updateParetoState: (pareto: ParetoState) => void;
  updateDynamicRegime: (regime: RegimeResult) => void;
  updateSignalFilter: (filter: SignalFilterState) => void;
  reset: () => void;
}

const initialState = {
  currentPrice: 0,
  orderBook: null,
  openInterest: null,
  currentSignal: null,
  marketRegime: null,
  markovPrediction: null,
  backtestResults: null,
  livePerformance: {
    pnl: 0,
    winRate: 0,
    totalTrades: 0
  },
  executionMode: 'paper' as const,
  isExecutionEnabled: false,
  recordingEnabled: false,
  recordedData: [],
  evaluationResults: null,
  stressResults: null,
  paretoState: null,
  dynamicRegime: null,
  paretoHistory: [],
  signalFilter: null
};

export const useTradingStore = create<TradingState>()(
  immer((set) => ({
    ...initialState,
    
    updateOrderBook: (orderBook) => set((state) => {
      state.orderBook = orderBook;
      if (orderBook.asks[0]) {
        state.currentPrice = parseFloat(orderBook.asks[0][0]);
      }
    }),
    
    updateSignal: (signal) => set((state) => {
      state.currentSignal = signal;
    }),
    
    updateRegime: (regime) => set((state) => {
      state.marketRegime = regime;
    }),
    
    updateMarkovPrediction: (prediction) => set((state) => {
      state.markovPrediction = prediction;
    }),
    
    updateBacktestResults: (results) => set((state) => {
      state.backtestResults = results;
    }),

    updateLivePerformance: (update) => set((state) => {
      state.livePerformance = { ...state.livePerformance, ...update };
    }),

    setExecutionMode: (mode) => set((state) => {
      state.executionMode = mode;
    }),

    setExecutionEnabled: (enabled) => set((state) => {
      state.isExecutionEnabled = enabled;
    }),

    startRecording: () => set((state) => {
      state.recordingEnabled = true;
    }),

    stopRecording: () => set((state) => {
      state.recordingEnabled = false;
    }),

    clearRecordedData: () => set((state) => {
      state.recordedData = [];
    }),

    appendRecordedData: (data) => set((state) => {
      state.recordedData.push(data);
    }),

    setEvaluationResults: (results) => set((state) => {
      state.evaluationResults = results;
    }),

    setStressResults: (results) => set((state) => {
      state.stressResults = results;
    }),

    updateParetoState: (pareto) => set((state) => {
      state.paretoState = JSON.parse(JSON.stringify(pareto));
      // Keep last 100 history points for dashboard chart
      state.paretoHistory.push({
        alpha: pareto.params.alpha,
        tailRisk: pareto.params.tailRisk,
        timestamp: pareto.timestamp,
      });
      if (state.paretoHistory.length > 100) {
        state.paretoHistory.shift();
      }
    }),

    updateDynamicRegime: (regime) => set((state) => {
      state.dynamicRegime = JSON.parse(JSON.stringify(regime));
    }),

    updateSignalFilter: (filter) => set((state) => {
      state.signalFilter = JSON.parse(JSON.stringify(filter));
    }),
    
    reset: () => set(() => initialState)
  }))
);
