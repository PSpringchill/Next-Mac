import { MarketData, Trade } from '@tradingEngine/types';
import PaperTradingEngine from './PaperTradingEngine';

export interface StressTestResult {
  scenario: string;
  trades: Trade[];
  maxDrawdown: number;
  finalPnl: number;
}

class StressTestHarness {
  private engine: PaperTradingEngine;

  constructor(engine?: PaperTradingEngine) {
    const defaultEngine = new PaperTradingEngine({
      processMarketData: async () => ({
        direction: 0,
        strength: 0,
        confidence: 0,
        timestamp: Date.now()
      })
    } as any);
    this.engine = engine ?? defaultEngine;
  }

  async runScenario(scenario: string, data: MarketData[]): Promise<StressTestResult> {
    let maxDrawdown = 0;
    let finalPnl = 0;

    for (const tick of data) {
      const result = await this.engine.processTick(tick);
      maxDrawdown = Math.max(maxDrawdown, result.portfolio.maxDrawdownToday);
      finalPnl = result.portfolio.dailyPnl;
    }

    return {
      scenario,
      trades: this.getTrades(),
      maxDrawdown,
      finalPnl
    };
  }

  async runFlashCrash(): Promise<StressTestResult> {
    const data = this.generateFlashCrashData();
    return this.runScenario('flash_crash', data);
  }

  async runApiFailure(): Promise<StressTestResult> {
    const data = this.generateApiFailureData();
    return this.runScenario('api_failure', data);
  }

  async runStaleFeed(): Promise<StressTestResult> {
    const data = this.generateStaleFeedData();
    return this.runScenario('stale_feed', data);
  }

  private getTrades(): Trade[] {
    const state = (this.engine as any);
    return state.trades ? [...state.trades] : [];
  }

  private generateFlashCrashData(): MarketData[] {
    const data: MarketData[] = [];
    let price = 100;
    for (let i = 0; i < 30; i += 1) {
      price *= i < 10 ? 1.002 : i < 20 ? 0.97 : 1.01;
      data.push(this.makeMarketTick(price));
    }
    return data;
  }

  private generateApiFailureData(): MarketData[] {
    const data: MarketData[] = [];
    let price = 100;
    for (let i = 0; i < 20; i += 1) {
      if (i % 5 === 0) {
        data.push(this.makeMarketTick(price));
      } else {
        price *= 1.001;
        data.push(this.makeMarketTick(price));
      }
    }
    return data;
  }

  private generateStaleFeedData(): MarketData[] {
    const data: MarketData[] = [];
    const price = 100;
    for (let i = 0; i < 20; i += 1) {
      data.push(this.makeMarketTick(price));
    }
    return data;
  }

  private makeMarketTick(price: number): MarketData {
    return {
      timestamp: Date.now(),
      price,
      orderBook: {
        lastUpdateId: 1,
        bids: [[(price - 0.5).toFixed(2), '1'] as [string, string]],
        asks: [[(price + 0.5).toFixed(2), '1'] as [string, string]]
      },
      openInterest: {
        openInterest: '1000',
        symbol: 'BTCUSDT',
        time: Date.now()
      },
      fundingRate: 0.0001
    };
  }
}

export default StressTestHarness;
