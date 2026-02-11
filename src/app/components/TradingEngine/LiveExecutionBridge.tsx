'use client';

import { useContext, useEffect, useMemo, useRef } from 'react';
import { OrderBookContext, OrderBookContextType } from '../../api/Page';
import { useTradingStore } from '@stores/tradingStore';
import PaperTradingEngine from './PaperTradingEngine';

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

  const paperEngineRef = useRef<PaperTradingEngine | null>(null);
  const lastUpdateRef = useRef(0);
  const processingRef = useRef(false);

  // Lazy init to avoid double-construction in React strict mode
  if (!paperEngineRef.current) {
    paperEngineRef.current = new PaperTradingEngine();
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
  }, [executionMode, isExecutionEnabled, marketData, recordingEnabled, appendRecordedData, updateSignal, updateLivePerformance, updateParetoState, updateDynamicRegime, updateSignalFilter, updateRadarVector, updateCircuitBreaker]);

  return null;
};

export default LiveExecutionBridge;
