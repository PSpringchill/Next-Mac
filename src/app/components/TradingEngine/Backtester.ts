// src/tradingEngine/Backtester.ts
import { 
  MarketData, 
  BacktestResult, 
  Trade, 
  OrderBookData, 
  OpenInterestData,
  MarketFeatures,
  TradingSignal 
} from '@tradingEngine/types';
import TradingEngine from './MLTradingCore';
import ExecutionEngine from './ExecutionEngine';
import RiskManager from './RiskManager';
import RewardCalculator, { ExecutionReport } from './RewardCalculator';
import { PortfolioState } from '@tradingEngine/types';

interface OptimizationResults {
  period: { start: number; end: number };
  performance: BacktestResult;
}

export interface TradingEngineLike {
  processMarketData: TradingEngine['processMarketData'];
}

class Backtester {
  private engine!: TradingEngineLike;
  private historicalData: MarketData[] = [];
  private executionEngine: ExecutionEngine;
  private riskManager: RiskManager;
  private rewardCalculator: RewardCalculator;
  
  constructor(engine: TradingEngineLike = new TradingEngine()) {
    this.engine = engine;
    this.riskManager = new RiskManager();
    this.executionEngine = new ExecutionEngine(this.riskManager);
    this.rewardCalculator = new RewardCalculator(this.riskManager);
  }
  
  async runWalkForwardOptimization(
    data: MarketData[],
    windowSize: number = 1000,
    stepSize: number = 100
  ): Promise<OptimizationResults[]> {
    const results: OptimizationResults[] = [];
    
    for (let i = windowSize; i < data.length; i += stepSize) {
      // Testing window
      const testData = data.slice(i, Math.min(i + stepSize, data.length));
      const performance = await this.backtest(testData);
      
      results.push({
        period: { start: i, end: i + stepSize },
        performance
      });
    }
    
    return results;
  }
  
  public async runBacktest(data: MarketData[]): Promise<BacktestResult> {
    return this.backtest(data);
  }

  private async backtest(data: MarketData[]): Promise<BacktestResult> {
    let portfolio = 100000; // Starting capital
    let position = 0;
    let avgEntryPrice = 0;
    let equityPeak = portfolio;
    const trades: Trade[] = [];

    let portfolioState: PortfolioState = {
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
    
    for (const marketData of data) {
      const signal = await this.engine.processMarketData(
        marketData.orderBook,
        marketData.openInterest,
        marketData.fundingRate
      );
      
      // Execute trade based on signal
      if (signal.direction !== 0 && signal.confidence > 0.7) {
        const direction = signal.direction > 0 ? 1 : -1;
        const size = Math.abs((portfolio * signal.strength * 0.1) / marketData.price); // 10% risk budget

        const execution = this.executionEngine.executeOrder(
          {
            direction: direction as -1 | 1,
            size,
            urgency: signal.confidence
          },
          marketData.orderBook,
          { volatility: 0 }
        );

        if (execution.status === 'filled' && execution.filledSize > 0) {
          let realizedPnl = 0;
          if (direction > 0) {
            const cost = execution.fillPrice * execution.filledSize;
            portfolio -= cost;
            const totalPositionCost = position * avgEntryPrice + cost;
            position += execution.filledSize;
            avgEntryPrice = position > 0 ? totalPositionCost / position : 0;
            trades.push({
              type: 'BUY',
              price: execution.fillPrice,
              size: execution.filledSize,
              timestamp: marketData.timestamp,
              pnl: 0
            });
          } else {
            const exitSize = Math.min(position, execution.filledSize);
            realizedPnl = exitSize * (execution.fillPrice - avgEntryPrice);
            portfolio += execution.fillPrice * execution.filledSize;
            position = Math.max(0, position - execution.filledSize);
            if (position === 0) avgEntryPrice = 0;
            trades.push({
              type: 'SELL',
              price: execution.fillPrice,
              size: execution.filledSize,
              timestamp: marketData.timestamp,
              pnl: realizedPnl
            });
          }

          const equity = portfolio + position * marketData.price;
          equityPeak = Math.max(equityPeak, equity);
          const drawdown = equityPeak - equity;

          const nextState: PortfolioState = {
            ...portfolioState,
            position,
            unrealizedPnl: position * (marketData.price - avgEntryPrice),
            dailyPnl: equity - 100000,
            tradesToday: portfolioState.tradesToday + 1,
            maxDrawdownToday: Math.max(portfolioState.maxDrawdownToday, drawdown),
            lastTradeTimestamp: marketData.timestamp
          };

          this.rewardCalculator.computeReward(
            { portfolio: portfolioState },
            { portfolio: nextState },
            {
              realizedPnl,
              fillPrice: execution.fillPrice,
              midPriceAtOrder: execution.midPriceAtOrder
            } as ExecutionReport,
            direction
          );

          portfolioState = nextState;
          this.riskManager.updatePortfolioState(portfolioState);
        }
      }
    }
    
    return this.calculateMetrics(trades, portfolio);
  }
  
  private calculateMetrics(trades: Trade[], finalPortfolio: number): BacktestResult {
    const initialPortfolio = 100000;
    const totalReturn = (finalPortfolio - initialPortfolio) / initialPortfolio;
    
    // Calculate Sharpe ratio (simplified)
    const returns = trades.map(trade => ((trade.pnl || 0) / initialPortfolio));
    const avgReturn = returns.length > 0 ? returns.reduce((sum, ret) => sum + ret, 0) / returns.length : 0;
    const returnStd = returns.length > 0 ? Math.sqrt(
      returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length
    ) : 0.01;
    const sharpeRatio = avgReturn / (returnStd || 0.01);
    
    // Calculate max drawdown
    let maxDrawdown = 0;
    let peak = initialPortfolio;
    let runningPortfolio = initialPortfolio;
    
    for (const trade of trades) {
      if (trade.pnl) {
        runningPortfolio += trade.pnl;
        if (runningPortfolio > peak) {
          peak = runningPortfolio;
        } else {
          const drawdown = (peak - runningPortfolio) / peak;
          maxDrawdown = Math.max(maxDrawdown, drawdown);
        }
      }
    }
    
    // Calculate win rate
    const winningTrades = trades.filter(trade => (trade.pnl || 0) > 0);
    const winRate = trades.length > 0 ? winningTrades.length / trades.length : 0;
    
    return {
      totalReturn,
      sharpeRatio,
      maxDrawdown,
      winRate,
      trades
    };
  }

  private analyzeResults(results: OptimizationResults[]): OptimizationResults {
    // Aggregate results across all periods
    const allTrades = results.flatMap(r => r.performance.trades);
    const avgReturn = results.reduce((sum, r) => sum + r.performance.totalReturn, 0) / results.length;
    const avgSharpe = results.reduce((sum, r) => sum + r.performance.sharpeRatio, 0) / results.length;
    const maxDrawdown = Math.max(...results.map(r => r.performance.maxDrawdown));
    const avgWinRate = results.reduce((sum, r) => sum + r.performance.winRate, 0) / results.length;
    
    return {
      period: { start: 0, end: results.length },
      performance: {
        totalReturn: avgReturn,
        sharpeRatio: avgSharpe,
        maxDrawdown,
        winRate: avgWinRate,
        trades: allTrades
      }
    };
  }

  setHistoricalData(data: MarketData[]): void {
    this.historicalData = data;
  }
}

export default Backtester;