'use client';

import { useContext, useEffect, useMemo, useRef } from 'react';
import { OrderBookContext } from '../../api/Page';
import { useTradingStore } from '@stores/tradingStore';
import PaperTradingEngine from './PaperTradingEngine';

const LiveExecutionBridge = () => {
  const orderBookContext = useContext(OrderBookContext) as any;
  const executionMode = useTradingStore((state) => state.executionMode);
  const isExecutionEnabled = useTradingStore((state) => state.isExecutionEnabled);
  const recordingEnabled = useTradingStore((state) => state.recordingEnabled);
  const appendRecordedData = useTradingStore((state) => state.appendRecordedData);
  const updateSignal = useTradingStore((state) => state.updateSignal);
  const updateLivePerformance = useTradingStore((state) => state.updateLivePerformance);

  const paperEngineRef = useRef(new PaperTradingEngine());
  const lastUpdateRef = useRef(0);

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
    if (now - lastUpdateRef.current < 500) return;
    lastUpdateRef.current = now;

    if (recordingEnabled) {
      appendRecordedData(marketData);
    }

    if (!isExecutionEnabled) return;

    if (executionMode === 'paper') {
      paperEngineRef.current.processTick(marketData).then((result) => {
        updateSignal(result.signal);
        updateLivePerformance({
          pnl: result.portfolio.dailyPnl,
          totalTrades: result.trades.length,
          winRate: result.trades.length
            ? result.trades.filter((trade) => (trade.pnl ?? 0) > 0).length / result.trades.length
            : 0
        });
      });
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
  }, [executionMode, isExecutionEnabled, marketData, recordingEnabled, appendRecordedData, updateSignal, updateLivePerformance]);

  return null;
};

export default LiveExecutionBridge;
