import { EventEmitter } from 'events';
import {
  MarketData,
  Trade,
  TradingSignal,
  PortfolioState
} from '@tradingEngine/types';
import TradingEngine from './MLTradingCore';
import ExecutionEngine from './ExecutionEngine';
import RiskManager from './RiskManager';
import RewardCalculator, { ExecutionReport } from './RewardCalculator';

export interface PaperTradeResult {
  signal: TradingSignal;
  execution?: ExecutionReport;
  reward?: number;
  portfolio: PortfolioState;
  trades: Trade[];
}

class PaperTradingEngine extends EventEmitter {
  private engine: { processMarketData: TradingEngine['processMarketData'] };
  private executionEngine: ExecutionEngine;
  private riskManager: RiskManager;
  private rewardCalculator: RewardCalculator;
  private portfolio: number;
  private position: number;
  private avgEntryPrice: number;
  private equityPeak: number;
  private trades: Trade[];
  private portfolioState: PortfolioState;

  constructor(
    engine: { processMarketData: TradingEngine['processMarketData'] } = new TradingEngine(),
    riskManager: RiskManager = new RiskManager()
  ) {
    super();
    this.engine = engine;
    this.riskManager = riskManager;
    this.executionEngine = new ExecutionEngine(this.riskManager);
    this.rewardCalculator = new RewardCalculator(this.riskManager);
    this.portfolio = 100000;
    this.position = 0;
    this.avgEntryPrice = 0;
    this.equityPeak = this.portfolio;
    this.trades = [];
    this.portfolioState = {
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
  }

  async processTick(marketData: MarketData): Promise<PaperTradeResult> {
    const signal = await this.engine.processMarketData(
      marketData.orderBook,
      marketData.openInterest,
      marketData.fundingRate
    );

    let execution: ExecutionReport | undefined;
    let reward: number | undefined;

    if (signal.direction !== 0 && signal.confidence > 0.7) {
      const direction = signal.direction > 0 ? 1 : -1;
      const size = Math.abs((this.portfolio * signal.strength * 0.1) / marketData.price);

      const executionResult = this.executionEngine.executeOrder(
        {
          direction: direction as -1 | 1,
          size,
          urgency: signal.confidence
        },
        marketData.orderBook,
        { volatility: 0 }
      );

      if (executionResult.status === 'filled' && executionResult.filledSize > 0) {
        execution = {
          realizedPnl: 0,
          fillPrice: executionResult.fillPrice,
          midPriceAtOrder: executionResult.midPriceAtOrder
        };

        if (direction > 0) {
          const cost = executionResult.fillPrice * executionResult.filledSize;
          this.portfolio -= cost;
          const totalPositionCost = this.position * this.avgEntryPrice + cost;
          this.position += executionResult.filledSize;
          this.avgEntryPrice = this.position > 0 ? totalPositionCost / this.position : 0;
          this.trades.push({
            type: 'BUY',
            price: executionResult.fillPrice,
            size: executionResult.filledSize,
            timestamp: marketData.timestamp,
            pnl: 0
          });
        } else {
          const exitSize = Math.min(this.position, executionResult.filledSize);
          const realizedPnl = exitSize * (executionResult.fillPrice - this.avgEntryPrice);
          this.portfolio += executionResult.fillPrice * executionResult.filledSize;
          this.position = Math.max(0, this.position - executionResult.filledSize);
          if (this.position === 0) this.avgEntryPrice = 0;
          this.trades.push({
            type: 'SELL',
            price: executionResult.fillPrice,
            size: executionResult.filledSize,
            timestamp: marketData.timestamp,
            pnl: realizedPnl
          });
          execution.realizedPnl = realizedPnl;
        }

        const equity = this.portfolio + this.position * marketData.price;
        this.equityPeak = Math.max(this.equityPeak, equity);
        const drawdown = this.equityPeak - equity;

        const nextState: PortfolioState = {
          ...this.portfolioState,
          position: this.position,
          unrealizedPnl: this.position * (marketData.price - this.avgEntryPrice),
          dailyPnl: equity - 100000,
          tradesToday: this.portfolioState.tradesToday + 1,
          maxDrawdownToday: Math.max(this.portfolioState.maxDrawdownToday, drawdown),
          lastTradeTimestamp: marketData.timestamp
        };

        reward = this.rewardCalculator.computeReward(
          { portfolio: this.portfolioState },
          { portfolio: nextState },
          execution,
          direction
        );

        this.portfolioState = nextState;
        this.riskManager.updatePortfolioState(nextState);

        this.emit('trade', { signal, execution: executionResult, reward });
      }
    }

    const result: PaperTradeResult = {
      signal,
      execution,
      reward,
      portfolio: { ...this.portfolioState },
      trades: [...this.trades]
    };

    this.emit('portfolio_update', result);

    return result;
  }
}

export default PaperTradingEngine;
