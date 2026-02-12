'use client';

import { useContext, useEffect, useMemo, useRef } from 'react';
import { OrderBookContext, OrderBookContextType } from '../../api/Page';
import { useTradingStore } from '@stores/tradingStore';
import PaperTradingEngine from './PaperTradingEngine';
import RLDataCollector from './RLDataCollector';
import RLBacktestTrainer from './RLBacktestTrainer';
import A3CProtectAgent from './A3CProtectAgent';

const THROTTLE_MS = 800;

const LiveExecutionBridge = () => {
  const orderBookContext = useContext(OrderBookContext) as OrderBookContextType | null;
  const executionMode = useTradingStore((state) => state.executionMode);
  const isExecutionEnabled = useTradingStore((state) => state.isExecutionEnabled);
  const recordingEnabled = useTradingStore((state) => state.recordingEnabled);
  const appendRecordedData = useTradingStore((state) => state.appendRecordedData);
  const updateSignal = useTradingStore((state) => state.updateSignal);
  const updateLivePerformance = useTradingStore((state) => state.updateLivePerformance);
  const updateParetoState = useTradingStore((state) => state.updateParetoState);
  const updateDynamicRegime = useTradingStore((state) => state.updateDynamicRegime);
  const updateSignalFilter = useTradingStore((state) => state.updateSignalFilter);
  const updateRadarVector = useTradingStore((state) => state.updateRadarVector);
  const updateCircuitBreaker = useTradingStore((state) => state.updateCircuitBreaker);
  const updateRLTrainer = useTradingStore((state) => state.updateRLTrainer);
  const updateRLCollector = useTradingStore((state) => state.updateRLCollector);
  const updateProtectAgent = useTradingStore((state) => state.updateProtectAgent);

  const paperEngineRef = useRef<PaperTradingEngine | null>(null);
  const rlCollectorRef = useRef<RLDataCollector | null>(null);
  const rlTrainerRef = useRef<RLBacktestTrainer | null>(null);
  const protectAgentRef = useRef<A3CProtectAgent | null>(null);
  const priceHistoryRef = useRef<number[]>([]);
  const lastUpdateRef = useRef(0);
  const processingRef = useRef(false);

  // Lazy init to avoid double-construction in React strict mode
  if (!paperEngineRef.current) {
    paperEngineRef.current = new PaperTradingEngine();
  }
  if (!rlCollectorRef.current) {
    rlCollectorRef.current = new RLDataCollector();
  }
  if (!rlTrainerRef.current) {
    rlTrainerRef.current = new RLBacktestTrainer();
  }
  if (!protectAgentRef.current) {
    protectAgentRef.current = new A3CProtectAgent();
  }

  const marketData = useMemo(() => {
    const orderBook = orderBookContext?.orderBookData;
    const openInterest = orderBookContext?.openInterestData;
    if (!orderBook || !openInterest) return null;
    const bestAsk = parseFloat(orderBook.asks[0]?.[0] || '0');
    if (!bestAsk) return null;

    return {
      timestamp: Date.now(),
      price: bestAsk,
      orderBook,
      openInterest,
      fundingRate: 0
    };
  }, [orderBookContext?.orderBookData, orderBookContext?.openInterestData]);

  useEffect(() => {
    if (!marketData) return;

    const now = Date.now();
    if (now - lastUpdateRef.current < THROTTLE_MS) return;
    if (processingRef.current) return;
    lastUpdateRef.current = now;

    if (recordingEnabled) {
      appendRecordedData(marketData);
    }

    const engine = paperEngineRef.current;
    if (!engine) return;

    // Async IIFE: feedMonitoringData is now async (awaits HMM detectRegime)
    processingRef.current = true;
    (async () => {
      // Always feed Pareto, regime & signal filter monitoring (independent of execution state)
      const monitoring = await engine.feedMonitoringData(marketData);
      if (monitoring.pareto) {
        updateParetoState(monitoring.pareto);
      }
      if (monitoring.regime) {
        updateDynamicRegime(monitoring.regime);
      }
      if (monitoring.signalFilter) {
        updateSignalFilter(monitoring.signalFilter);
      }
      if (monitoring.radarVector) {
        updateRadarVector(monitoring.radarVector);
      }
      if (monitoring.circuitBreaker) {
        updateCircuitBreaker(monitoring.circuitBreaker);
      }

      // ─── RL Data Collection & Training ────────────────────────────
      const rlCollector = rlCollectorRef.current;
      const rlTrainer = rlTrainerRef.current;
      if (rlCollector && rlTrainer) {
        // Extract indicator data from monitoring
        const technicals = monitoring.signalFilter?.ensemble?.technicals ?? null;
        const linReg = monitoring.signalFilter?.linReg ?? null;

        // Compute OBI from order book
        const ob = marketData.orderBook;
        let obi = 0;
        if (ob.bids.length > 0 && ob.asks.length > 0) {
          const depth = Math.min(5, ob.bids.length, ob.asks.length);
          let bidVol = 0, askVol = 0;
          for (let i = 0; i < depth; i++) {
            bidVol += parseFloat(ob.bids[i][1] || '0');
            askVol += parseFloat(ob.asks[i][1] || '0');
          }
          obi = (bidVol + askVol) > 0 ? (bidVol - askVol) / (bidVol + askVol) : 0;
        }

        // Compute spread and volume
        const bestBid = parseFloat(ob.bids[0]?.[0] || '0');
        const bestAsk = parseFloat(ob.asks[0]?.[0] || '0');
        const spread = bestAsk > 0 ? bestAsk - bestBid : 0;
        const volume = parseFloat(ob.bids[0]?.[1] || '0') + parseFloat(ob.asks[0]?.[1] || '0');

        // Collect snapshot
        const snapshot = rlCollector.collect(
          marketData.price, technicals, linReg, obi, spread, volume,
        );

        // Run RL tick (inference + periodic backtest training)
        const rlState = rlTrainer.tick(snapshot, rlCollector.getBuffer());
        updateRLTrainer(rlState);
        updateRLCollector(rlCollector.getState());

        // ─── A3C Balance Protection Agent ──────────────────────────
        const protectAgent = protectAgentRef.current;
        if (protectAgent) {
          // Track price history for multi-TF changes
          priceHistoryRef.current.push(marketData.price);
          if (priceHistoryRef.current.length > 60) priceHistoryRef.current.shift();
          const ph = priceHistoryRef.current;
          const pn = ph.length;
          const pct5 = pn >= 6 ? (marketData.price - ph[pn - 6]) / ph[pn - 6] * 100 : 0;
          const pct20 = pn >= 21 ? (marketData.price - ph[pn - 21]) / ph[pn - 21] * 100 : 0;
          const pct50 = pn >= 51 ? (marketData.price - ph[pn - 51]) / ph[pn - 51] * 100 : 0;

          // Get portfolio state from engine
          const portfolio = engine.getPortfolioState() ?? {
            position: 0, unrealizedPnl: 0, timeInTradeSec: 0,
            marginUtilization: 0, tradesToday: 0, dailyPnl: 0,
            maxDrawdownToday: 0, availableRiskBudget: 1,
          };

          const protectState = protectAgent.tick(
            portfolio,
            technicals,
            monitoring.circuitBreaker ?? null,
            rlState,
            marketData.price,
            technicals?.atr.value ?? 0.01,
            { pct5, pct20, pct50 },
            spread,
            snapshot.features[26] ?? 0, // volume_roc from RL features
          );
          updateProtectAgent(protectState);
        }
      }

      if (!isExecutionEnabled) return;

      if (executionMode === 'paper') {
        const result = await engine.processTick(marketData);
        updateSignal(result.signal);
        updateLivePerformance({
          pnl: result.portfolio.dailyPnl,
          totalTrades: result.trades.length,
          winRate: result.trades.length
            ? result.trades.filter((trade) => (trade.pnl ?? 0) > 0).length / result.trades.length
            : 0
        });
        if (result.signalFilter) {
          updateSignalFilter(result.signalFilter);
        }
        return;
      }

      // Live mode placeholder: no exchange wiring yet
      updateSignal({
        direction: 0,
        strength: 0,
        confidence: 0,
        timestamp: Date.now(),
        metadata: { status: 'live_mode_pending' }
      });
    })().catch(err => console.error('[LiveExecutionBridge] monitoring error:', err))
      .finally(() => { processingRef.current = false; });
  }, [executionMode, isExecutionEnabled, marketData, recordingEnabled, appendRecordedData, updateSignal, updateLivePerformance, updateParetoState, updateDynamicRegime, updateSignalFilter, updateRadarVector, updateCircuitBreaker, updateRLTrainer, updateRLCollector, updateProtectAgent]);

  return null;
};

export default LiveExecutionBridge;
