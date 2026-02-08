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
    this.engine = engine ?? new PaperTradingEngine();
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

  private tickCounter = 0;

  private makeMarketTick(price: number): MarketData {
    this.tickCounter++;
    const spread = price * 0.001; // 0.1% spread
    const bestBid = price - spread / 2;
    const bestAsk = price + spread / 2;

    // Generate 10 levels of depth
    const bids: [string, string][] = [];
    const asks: [string, string][] = [];
    for (let i = 0; i < 10; i++) {
      const bidVol = 5 + Math.random() * 15;
      const askVol = 5 + Math.random() * 15;
      bids.push([(bestBid - i * spread * 0.5).toFixed(4), bidVol.toFixed(4)]);
      asks.push([(bestAsk + i * spread * 0.5).toFixed(4), askVol.toFixed(4)]);
    }

    return {
      timestamp: Date.now() + this.tickCounter * 500,
      price: bestAsk,
      orderBook: { lastUpdateId: this.tickCounter, bids, asks },
      openInterest: {
        openInterest: '50000',
        symbol: 'BTCUSDT',
        time: Date.now() + this.tickCounter * 500
      },
      fundingRate: 0
    };
  }
}

export default StressTestHarness;
