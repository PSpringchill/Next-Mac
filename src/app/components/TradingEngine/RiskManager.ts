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
  // Circuit Breaker thresholds
  cb1DrawdownPct: number;       // L1: drawdown % in 60 min (default 0.05)
  cb1HaltMinutes: number;       // L1: halt entries for N minutes (default 120)
  cb2DrawdownPct: number;       // L2: drawdown % in 24h (default 0.10)
  cb3PriceMovePct: number;      // L3: flash crash % move in 30s (default 0.05)
  cb3WindowSeconds: number;     // L3: flash crash detection window (default 30)
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

export type CircuitBreakerLevel = 0 | 1 | 2 | 3;

export interface CircuitBreakerState {
  level: CircuitBreakerLevel;
  activeSince: number | null;
  reason: string | null;
  stopMultiplier: number;       // 1.0 normal, 0.5 L1, 0.25 L3
  positionSizeMultiplier: number; // 1.0 normal, 0.5 L2
  entriesHalted: boolean;
}

export interface RiskCheckResult {
  allowed: boolean;
  reasons: string[];
  adjustedSize: number;
  killSwitchActivated: boolean;
  circuitBreaker?: CircuitBreakerState;
}

export interface RiskStatus {
  killSwitchActive: boolean;
  killSwitchUntil: number | null;
  warnings: string[];
  circuitBreaker: CircuitBreakerState;
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
  killSwitchVolatility: 5.0,
  cb1DrawdownPct: 0.05,
  cb1HaltMinutes: 120,
  cb2DrawdownPct: 0.10,
  cb3PriceMovePct: 0.05,
  cb3WindowSeconds: 30,
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

  // Circuit Breaker state
  private cbLevel: CircuitBreakerLevel = 0;
  private cbActiveSince: number | null = null;
  private cbReason: string | null = null;
  private cbHaltUntil: number | null = null;

  // Price history for flash crash detection (L3)
  private priceHistory: { price: number; timestamp: number }[] = [];

  // Equity snapshots for rolling drawdown (L1: 60min, L2: 24h)
  private equitySnapshots: { equity: number; timestamp: number }[] = [];

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

  // ─── Circuit Breaker System ─────────────────────────────────────────────

  feedPrice(price: number, timestamp: number = Date.now()): void {
    this.priceHistory.push({ price, timestamp });
    // Keep only last 60 seconds of prices
    const cutoff = timestamp - 60_000;
    while (this.priceHistory.length > 0 && this.priceHistory[0].timestamp < cutoff) {
      this.priceHistory.shift();
    }
  }

  feedEquity(equity: number, timestamp: number = Date.now()): void {
    this.equitySnapshots.push({ equity, timestamp });
    // Keep only last 24 hours
    const cutoff = timestamp - 24 * 60 * 60_000;
    while (this.equitySnapshots.length > 0 && this.equitySnapshots[0].timestamp < cutoff) {
      this.equitySnapshots.shift();
    }
  }

  evaluateCircuitBreakers(timestamp: number = Date.now()): CircuitBreakerState {
    // Check if existing halt has expired
    if (this.cbHaltUntil && timestamp >= this.cbHaltUntil) {
      this.cbLevel = 0;
      this.cbActiveSince = null;
      this.cbReason = null;
      this.cbHaltUntil = null;
    }

    // L3: Flash crash — price moved > cb3PriceMovePct in cb3WindowSeconds
    if (this.priceHistory.length >= 2) {
      const windowCutoff = timestamp - this.config.cb3WindowSeconds * 1000;
      const recentPrices = this.priceHistory.filter(p => p.timestamp >= windowCutoff);
      if (recentPrices.length >= 2) {
        const oldest = recentPrices[0].price;
        const newest = recentPrices[recentPrices.length - 1].price;
        const movePct = Math.abs(newest - oldest) / oldest;
        if (movePct >= this.config.cb3PriceMovePct) {
          this.cbLevel = 3;
          this.cbActiveSince = timestamp;
          this.cbReason = `L3 Flash Crash: ${(movePct * 100).toFixed(1)}% move in ${this.config.cb3WindowSeconds}s`;
          this.cbHaltUntil = null; // Manual reset required
        }
      }
    }

    // L2: 10% drawdown in 24h
    if (this.cbLevel < 3 && this.equitySnapshots.length >= 2) {
      const peak24h = Math.max(...this.equitySnapshots.map(s => s.equity));
      const current = this.equitySnapshots[this.equitySnapshots.length - 1]?.equity ?? peak24h;
      const dd24h = peak24h > 0 ? (peak24h - current) / peak24h : 0;
      if (dd24h >= this.config.cb2DrawdownPct) {
        this.cbLevel = 2;
        this.cbActiveSince = timestamp;
        this.cbReason = `L2: ${(dd24h * 100).toFixed(1)}% drawdown in 24h`;
        this.cbHaltUntil = null; // Manual review required
      }
    }

    // L1: 5% drawdown in 60min
    if (this.cbLevel < 2 && this.equitySnapshots.length >= 2) {
      const cutoff60m = timestamp - 60 * 60_000;
      const recent60m = this.equitySnapshots.filter(s => s.timestamp >= cutoff60m);
      if (recent60m.length >= 2) {
        const peak60m = Math.max(...recent60m.map(s => s.equity));
        const current = recent60m[recent60m.length - 1]?.equity ?? peak60m;
        const dd60m = peak60m > 0 ? (peak60m - current) / peak60m : 0;
        if (dd60m >= this.config.cb1DrawdownPct) {
          this.cbLevel = 1;
          this.cbActiveSince = timestamp;
          this.cbReason = `L1: ${(dd60m * 100).toFixed(1)}% drawdown in 60min`;
          this.cbHaltUntil = timestamp + this.config.cb1HaltMinutes * 60_000;
        }
      }
    }

    return this.getCircuitBreakerState();
  }

  getCircuitBreakerState(): CircuitBreakerState {
    return {
      level: this.cbLevel,
      activeSince: this.cbActiveSince,
      reason: this.cbReason,
      stopMultiplier: this.cbLevel === 3 ? 0.25 : this.cbLevel === 1 ? 0.5 : 1.0,
      positionSizeMultiplier: this.cbLevel === 2 ? 0.5 : 1.0,
      entriesHalted: this.cbLevel >= 1,
    };
  }

  resetCircuitBreaker(): void {
    this.cbLevel = 0;
    this.cbActiveSince = null;
    this.cbReason = null;
    this.cbHaltUntil = null;
  }

  getStatus(): RiskStatus {
    const now = Date.now();
    const killSwitchActive = this.killSwitchUntil !== null && now < this.killSwitchUntil;
    return {
      killSwitchActive,
      killSwitchUntil: this.killSwitchUntil,
      warnings: [],
      circuitBreaker: this.getCircuitBreakerState(),
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
