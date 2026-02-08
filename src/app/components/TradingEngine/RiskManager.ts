import { MarketRegime, PortfolioState } from '@tradingEngine/types';

export interface RiskConfig {
  maxPositionSize: number;
  maxDailyLoss: number;
  maxDrawdownFromPeak: number;
  maxOrdersPerMinute: number;
  maxNotionalExposure: number;
  warningDrawdownPct: number;
  warningLossRate: number;
  volatileRegimeMultiplier: number;
  trendingRegimeMultiplier: number;
  rangingRegimeMultiplier: number;
  killSwitchDailyLoss: number;
  killSwitchCooldown: number;
  killSwitchVolatility: number;
}

export interface TradeRequest {
  direction: -1 | 0 | 1;
  size: number;
  price: number;
  notional?: number;
  timestamp?: number;
}

export interface MarketContext {
  volatility?: number;
  regime?: MarketRegime;
}

export interface RiskCheckResult {
  allowed: boolean;
  reasons: string[];
  adjustedSize: number;
  killSwitchActivated: boolean;
}

export interface RiskStatus {
  killSwitchActive: boolean;
  killSwitchUntil: number | null;
  warnings: string[];
}

const DEFAULT_CONFIG: RiskConfig = {
  maxPositionSize: 0.5,
  maxDailyLoss: 5000,
  maxDrawdownFromPeak: 15000,
  maxOrdersPerMinute: 10,
  maxNotionalExposure: 50000,
  warningDrawdownPct: 0.7,
  warningLossRate: 3,
  volatileRegimeMultiplier: 0.3,
  trendingRegimeMultiplier: 1.0,
  rangingRegimeMultiplier: 0.6,
  killSwitchDailyLoss: 8000,
  killSwitchCooldown: 30 * 60 * 1000,
  killSwitchVolatility: 5.0
};

const DEFAULT_PORTFOLIO_STATE: PortfolioState = {
  position: 0,
  unrealizedPnl: 0,
  timeInTradeSec: 0,
  marginUtilization: 0,
  tradesToday: 0,
  dailyPnl: 0,
  maxDrawdownToday: 0,
  availableRiskBudget: 1,
  volatility: 0,
  lastTradeTimestamp: null
};

class RiskManager {
  private config: RiskConfig;
  private portfolioState: PortfolioState;
  private orderTimestamps: number[] = [];
  private killSwitchUntil: number | null = null;
  private consecutiveLosses: number = 0;

  constructor(config?: Partial<RiskConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.portfolioState = { ...DEFAULT_PORTFOLIO_STATE };
  }

  getConfig(): RiskConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<RiskConfig>): RiskConfig {
    this.config = { ...this.config, ...config };
    return this.getConfig();
  }

  getPortfolioState(): PortfolioState {
    return { ...this.portfolioState };
  }

  updatePortfolioState(update: Partial<PortfolioState>): PortfolioState {
    this.portfolioState = { ...this.portfolioState, ...update };
    return this.getPortfolioState();
  }

  recordTradeResult(pnl: number): void {
    if (pnl < 0) {
      this.consecutiveLosses += 1;
    } else {
      this.consecutiveLosses = 0;
    }
  }

  evaluateTrade(request: TradeRequest, context: MarketContext = {}): RiskCheckResult {
    const now = request.timestamp ?? Date.now();
    const reasons: string[] = [];
    const warnings: string[] = [];
    let allowed = true;
    let killSwitchActivated = false;

    if (this.killSwitchUntil && now < this.killSwitchUntil) {
      return {
        allowed: false,
        reasons: ['Kill switch active'],
        adjustedSize: 0,
        killSwitchActivated: true
      };
    }

    const volatility = context.volatility ?? this.portfolioState.volatility ?? 0;
    if (volatility >= this.config.killSwitchVolatility) {
      this.activateKillSwitch(now);
      return {
        allowed: false,
        reasons: ['Volatility gate triggered'],
        adjustedSize: 0,
        killSwitchActivated: true
      };
    }

    if (this.portfolioState.dailyPnl <= -this.config.killSwitchDailyLoss) {
      this.activateKillSwitch(now);
      return {
        allowed: false,
        reasons: ['Daily loss kill switch triggered'],
        adjustedSize: 0,
        killSwitchActivated: true
      };
    }

    if (this.portfolioState.dailyPnl <= -this.config.maxDailyLoss) {
      reasons.push('Daily loss limit reached');
      allowed = false;
    }

    if (this.portfolioState.maxDrawdownToday >= this.config.maxDrawdownFromPeak) {
      reasons.push('Max drawdown limit reached');
      allowed = false;
    }

    // Clamp size to available position capacity (direction-aware)
    const currentPos = this.portfolioState.position;
    const isReducing = (request.direction === -1 && currentPos > 0) || (request.direction === 1 && currentPos < 0);
    const availableSize = isReducing
      ? Math.abs(currentPos)  // can close up to full position
      : this.config.maxPositionSize - Math.abs(currentPos); // remaining capacity
    const adjustedSize = Math.min(Math.abs(request.size), Math.max(0, availableSize));

    if (adjustedSize <= 0) {
      reasons.push('Position size limit reached — no capacity');
      allowed = false;
    }

    const notional = request.notional ?? Math.abs(adjustedSize * request.price);
    if (notional > this.config.maxNotionalExposure) {
      reasons.push('Notional exposure exceeds limit');
      allowed = false;
    }

    const orderRate = this.getOrderRate(now);
    if (orderRate >= this.config.maxOrdersPerMinute) {
      reasons.push('Order rate limit exceeded');
      allowed = false;
    }

    if (this.portfolioState.maxDrawdownToday >= this.config.maxDrawdownFromPeak * this.config.warningDrawdownPct) {
      warnings.push('Approaching max drawdown');
    }

    if (this.consecutiveLosses >= this.config.warningLossRate) {
      warnings.push('Loss streak detected');
    }

    if (!allowed) {
      return {
        allowed: false,
        reasons: [...reasons, ...warnings],
        adjustedSize: 0,
        killSwitchActivated
      };
    }

    this.recordOrder(now);

    return {
      allowed: true,
      reasons: warnings,
      adjustedSize,
      killSwitchActivated
    };
  }

  computePositionSize(params: {
    winRate: number;
    avgWin: number;
    avgLoss: number;
    confidence: number;
    regime?: MarketRegime;
  }): number {
    const { winRate, avgWin, avgLoss, confidence, regime } = params;
    const b = avgLoss !== 0 ? avgWin / avgLoss : 0;
    const q = 1 - winRate;
    const kelly = b > 0 ? Math.max(0, (winRate * b - q) / b) : 0;
    const regimeMultiplier = this.getRegimeMultiplier(regime?.name);
    return Math.min(1, Math.max(0, kelly * confidence * regimeMultiplier));
  }

  getStatus(): RiskStatus {
    const now = Date.now();
    const killSwitchActive = this.killSwitchUntil !== null && now < this.killSwitchUntil;
    return {
      killSwitchActive,
      killSwitchUntil: this.killSwitchUntil,
      warnings: []
    };
  }

  private getRegimeMultiplier(regimeName?: string): number {
    if (!regimeName) return 1;
    if (regimeName.includes('volatile')) return this.config.volatileRegimeMultiplier;
    if (regimeName.includes('range')) return this.config.rangingRegimeMultiplier;
    return this.config.trendingRegimeMultiplier;
  }

  private activateKillSwitch(now: number): void {
    this.killSwitchUntil = now + this.config.killSwitchCooldown;
  }

  private recordOrder(timestamp: number): void {
    this.orderTimestamps.push(timestamp);
    this.pruneOrderTimestamps(timestamp);
  }

  private getOrderRate(now: number): number {
    this.pruneOrderTimestamps(now);
    return this.orderTimestamps.length;
  }

  private pruneOrderTimestamps(now: number): void {
    const windowMs = 60 * 1000;
    this.orderTimestamps = this.orderTimestamps.filter(ts => now - ts <= windowMs);
  }
}

export default RiskManager;
