'use client';

import React, { createContext, useContext, useMemo, useCallback, useState, ReactNode } from 'react';
import RiskManager, {
  RiskConfig,
  RiskCheckResult,
  TradeRequest,
  MarketContext,
  RiskStatus
} from '../components/TradingEngine/RiskManager';
import { PortfolioState } from '@tradingEngine/types';

interface RiskContextType {
  riskManager: RiskManager;
  config: RiskConfig;
  portfolioState: PortfolioState;
  status: RiskStatus;
  updateConfig: (config: Partial<RiskConfig>) => void;
  updatePortfolioState: (update: Partial<PortfolioState>) => void;
  evaluateTrade: (request: TradeRequest, context?: MarketContext) => RiskCheckResult;
  recordTradeResult: (pnl: number) => void;
  computePositionSize: (params: {
    winRate: number;
    avgWin: number;
    avgLoss: number;
    confidence: number;
  }) => number;
}

const RiskContext = createContext<RiskContextType | null>(null);

export const RiskProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [riskManager] = useState(() => new RiskManager());
  const [config, setConfig] = useState<RiskConfig>(riskManager.getConfig());
  const [portfolioState, setPortfolioState] = useState<PortfolioState>(riskManager.getPortfolioState());
  const [status, setStatus] = useState<RiskStatus>(riskManager.getStatus());

  const updateConfig = useCallback((update: Partial<RiskConfig>) => {
    const nextConfig = riskManager.updateConfig(update);
    setConfig(nextConfig);
    setStatus(riskManager.getStatus());
  }, [riskManager]);

  const updatePortfolioState = useCallback((update: Partial<PortfolioState>) => {
    const nextState = riskManager.updatePortfolioState(update);
    setPortfolioState(nextState);
    setStatus(riskManager.getStatus());
  }, [riskManager]);

  const evaluateTrade = useCallback((request: TradeRequest, context?: MarketContext) => {
    const result = riskManager.evaluateTrade(request, context);
    setStatus(riskManager.getStatus());
    return result;
  }, [riskManager]);

  const recordTradeResult = useCallback((pnl: number) => {
    riskManager.recordTradeResult(pnl);
    setStatus(riskManager.getStatus());
  }, [riskManager]);

  const computePositionSize = useCallback((params: {
    winRate: number;
    avgWin: number;
    avgLoss: number;
    confidence: number;
  }) => riskManager.computePositionSize(params), [riskManager]);

  const value = useMemo(() => ({
    riskManager,
    config,
    portfolioState,
    status,
    updateConfig,
    updatePortfolioState,
    evaluateTrade,
    recordTradeResult,
    computePositionSize
  }), [riskManager, config, portfolioState, status]);

  return (
    <RiskContext.Provider value={value}>
      {children}
    </RiskContext.Provider>
  );
};

export const useRiskManager = () => {
  const context = useContext(RiskContext);
  if (!context) {
    throw new Error('useRiskManager must be used within a RiskProvider');
  }
  return context;
};
